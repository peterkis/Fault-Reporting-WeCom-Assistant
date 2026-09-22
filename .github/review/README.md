# Published-history review preflight

## 2026-09-22 successor CI scope correction

PR #21's Ubuntu and Windows evidence-history jobs reproduced
`YXX_LOCAL_VALIDATION_SCOPE_INVALID` because the SS-009 scope regression created
a worktree at current HEAD. That HEAD contains the authorized successor migration
035, whereas the historical SS-008 scope freezes the original migration directory.
The historical scope and validator remain unchanged and still reject that current
checkout; they must not be relaxed or represented as current workbench readiness.

The workflow now executes all original SS-009 tests, r6 mutation probes, architecture
checks and the unchanged strict CLI in a separate CRLF clone at PR #19's final
published head `41edd855e7bc55149facb6a4b2e0076776c22e66` (GitHub PR API verified).
The isolated clone's `origin/main` is set to that PR's GitHub-verified base
`375d47b013017edb858206cc5f3475c9aed77dfd`, because original architecture validators
compare that ref. The live checkout and its refs are untouched. Its ancestry and exact identity are checked before use. Outputs explicitly identify
the historical fixture. Missing history, tampering or strict failures remain fatal.

On the actual PR head the job retains the published-object preflight, runs current
OAuth/workbench unit and HTTP regression tests, and checks the PR event's base-to-head
evidence history. `pr-evidence-delta.mjs` rejects modifications/deletions, including
an added evidence file subsequently rewritten and then restored. Its base is the
GitHub PR event base, not a replacement for the original SS009 trust anchor; no
override is passed to the historical validator. This distinguishes evidence already
in the parent release from changes proposed in the current PR. It does not certify
the current candidate against a historical report. PostgreSQL/browser and live
acceptance remain independently reported in the delivery evidence.

## Why PR #19 kept receiving the same ancestry finding

The latest finding was attached to the published review head `20c2f032106e897b3ac802355b5218e363646a3d`, but its body evaluated `3fdfeeedefee5afade93004320765d6ac43ffe60` instead.

Independent GitHub API reads during this repair establish:

- `GET /repos/peterkis/Fault-Reporting-WeCom-Assistant/git/commits/20c2f032106e897b3ac802355b5218e363646a3d` returns the sole parent `dcf688038a76e471b443be33af4aad6278d72bd2`, exactly the r5 report's tested_head.
- Comparing that tested_head with the reviewed published head returns `ahead_by=1`, `behind_by=0`, and merge base `dcf688038a76e471b443be33af4aad6278d72bd2`.
- The repository's Git commit API returns HTTP 404 for `3fdfeeedefee5afade93004320765d6ac43ffe60`. Its provenance is unverified. This does not prove that the object never existed in any other environment; it does mean it cannot be substituted for the published head.

The earlier repeated findings/replies show the same distinction between review metadata and separately named objects. A reparented review snapshot is consistent with the reported symptoms, but this repair does not claim access to, or certainty about, the review provider's internal snapshot construction.

Rebinding a correct tested_head or generating another evidence revision cannot repair an environment that keeps substituting a different commit graph. This repair establishes the commit's identity *before* drawing an ancestry conclusion, while retaining the original evidence gate.

## Two separate checks, not a weaker gate

```text
GitHub PR event / review metadata gives an authoritative full SHA
  -> full, clean checkout of that exact object using the recorded EOL policy
  -> verify-published-history.mjs
  -> unchanged validate-yxx-self-service.mjs --require-ready
```

The preflight accepts the exact published PR head, or an explicitly identified GitHub merge preview whose two ordered parents equal the same event's base and head. It never accepts arbitrary same-tree commits.

It rejects shallow clones, replace refs/grafts, dirty worktrees, missing objects, mismatched raw commit identities, wrong tested trees, and real ancestry breaks. It uses Git without replacement objects, sanitizes inherited Git environment overrides, performs no network requests, and does not write to the checkout, index, reports or refs.

The current report is read from the committed `plans/yxx-self-service-ticket-plan.json` entry for `YXX-SS-009`; there is no frozen r5 or head SHA in the executable.

| Result | Meaning |
| --- | --- |
| Exit 0 / `REVIEW_HISTORY_PREFLIGHT_PASS_NOT_READINESS` | Identity and ancestry checks passed. Strict readiness is still `NOT_RUN`. Run the original strict command. |
| Exit 2 / `REVIEW_CHECKOUT_IDENTITY_MISMATCH` | Local checkout is not the authoritative object. Reconstruct the review environment, not the evidence. |
| Exit 2 / incomplete, overlay, dirty or unavailable history | The environment cannot support this history conclusion. Fetch a clean full checkout; otherwise report this verification as unavailable. |
| Exit 1 / `PUBLISHED_EVIDENCE_ANCESTRY_MISMATCH` | The exact identity-verified published object really lacks the tested ancestor. Preserve the history or regenerate evidence; this remains a defect. |

An environment problem does not exempt other independently reproducible code findings from review.

## Recorded checkout line endings are also part of reproduction

The unchanged strict validator checks `.gitignore` both as a Git blob and as raw working-tree bytes. The original start receipt records SHA-256 `0350afa8c952a92ee938901ae5e079c993c87d5ff1bb672a4e7a827f5d52d092`, which is the CRLF checkout of the committed blob `942b2b8d94b4f1e9dda5369cbac0cbe31056d950`. An LF checkout of the same blob instead hashes to `77263d448627a427f2fe085f2b32bf4ffb1fc7b44d2bbc3d1240e632c65f9fdc`.

Actions run `35489778695` reproduced the LF failure at `src/yxx-self-service-verification.mjs:126`, after authoritative history checks had already passed. This is a separate checkout-reproduction issue, not a failed ancestor assertion. The workflow now sets `core.autocrlf=true` **before checkout**, retains that setting in the isolated repository, and verifies the raw bytes against the original receipt. No `.gitignore`, start receipt, runtime source, candidate fingerprint or assertion was edited.

For a new independent local review clone, set the policy during cloning, not after files have already been materialized:

```sh
git clone --config core.autocrlf=true --no-single-branch <REPOSITORY_URL> <NEW_REVIEW_DIRECTORY>
```

Do not reset or overwrite an existing development worktree just to reproduce this environment. Merely setting `core.autocrlf` after checkout does not necessarily rewrite already-present files. A default LF clone still fails the original raw-byte assertion; the documented CRLF clone reproduces the recorded contract without weakening it.

## Running locally

Get the full head SHA from the GitHub PR API or the exact review's metadata, not from `git rev-parse HEAD`. A past review must be checked against its own recorded head, not silently against a newer revision.

In a clean full checkout of that object using the recorded EOL policy:

```sh
node --test --test-reporter=tap .github/review/verify-published-history.test.mjs
node .github/review/verify-published-history.mjs --expected-head <FULL_SHA_FROM_GITHUB>
node scripts/validate-yxx-self-service.mjs --require-ready
```

For a GitHub-generated merge preview, supply all three values from the same event/API observation:

```sh
node .github/review/verify-published-history.mjs --expected-head <PR_HEAD_SHA> --expected-merge <MERGE_PREVIEW_SHA> --expected-base <BASE_SHA>
node scripts/validate-yxx-self-service.mjs --require-ready
```

Logs must be written outside the checkout so they do not become untracked candidate files. A shallow or reconstructed sandbox should use a separate fresh clone; do not reset the user's worktree or manufacture a replacement parent chain. Merely fetching an object does not change a wrongly checked-out HEAD.

## Automated reproducibility

`.github/workflows/ss009-published-history.yml` runs on PR #19 with separate `head` and `merge` jobs. Each uses the event's exact SHA, `fetch-depth: 0` and the recorded CRLF checkout policy, runs the synthetic Git tests, runs the preflight, installs locked dependencies with lifecycle scripts disabled, and runs the unchanged strict CLI. Logs are uploaded from the runner's temporary directory, outside both the candidate inventory and historical evidence. If the strict CLI rejects, a failure-only diagnostic invokes the same exported validator to expose the actual assertion without changing the failed job result.

The workflow is intentionally scoped to this SS-009 delivery PR, not installed as a permanent frozen-SS009 gate for unrelated later work. The review preflight itself remains reusable. The workflow has read-only contents permissions, does not use pull_request_target, does not load environment files or production credentials, and does not deploy, merge, connect to WeCom, access hospital data, or advance any Gate.

These files belong to review infrastructure under `.github`, outside the already established runtime candidate roots. No candidate exclusion was added. Runtime source, product tests, scripts, package files, migrations, original reports, plan status and the original strict validator remain unchanged by this repair.

## Tests and truthful completion boundaries

The repair's 22 synthetic Git tests passed locally with Node v22.16.0 and Git 2.47.3. They exercise actual temporary repositories, including a same-tree single-parent snapshot, a genuine published squash, two-parent previews, a real shallow clone, replacement refs, grafts, dirty trees, invalid reports, CLI argument validation, read-only behavior and inherited Git environment isolation. Temporary repositories are test-owned and removed after each test.

On repair commit `906c37fba0adf2b3487ffa367d55beb4918c572f`, Actions run `35489854027` completed successfully for both the published head (job `106022819249`) and the merge preview (job `106022819140`). Each passed the synthetic Git tests, original raw-byte receipt check, authoritative history preflight, and **unchanged strict CLI**. These are actual remote results, not inferred from the local tooling tests. Later documentation-only commits must still be evaluated by their own Actions run.

The product's Node 24 runtime requirement is unchanged. CI uses Node 24. This verification does not claim a new full product regression run, browser test, PostgreSQL run, independent product review, live validation or Codex approval. The existing r5 `1182/1182` result remains the historical execution recorded by that report, not a new result created by this repair. The strict validator rechecks the existing evidence and its source binding.

Appending review-only commits preserves the tested ancestor; it does not require replacing the recorded tested_head with the latest documentation commit. A genuine squash/rebase that loses the tested ancestor still cannot reuse completion evidence without regenerating it. No automatic PR merge is performed.

## 审查结束条件与后续减量

### PR #21 五次既有 G0 修改的一次性处置（2026-09-22）

负责人在本次修复会话明确选择“同意：仅对这五次既有修改登记精确例外”。这是对已发布违规的具名处置，不宣称这些修改原本符合不可改写规则。

- `f29da5fb14d3e9a5c60ec27edbd6feedf69e3270`：帧 JSONL 追加两条脱敏记录、文本能力矩阵追加复核、HTTP 记录追加非敏感资料复核。
- `87b12ab6d0929fc069326a58159917cda075a4a4`：主动推送矩阵覆写一条成员资料结论并增加 OAuth2 行；HTTP 记录插入 OAuth2 流程及追加授权结果。矩阵覆写事实不能用“只是追加”掩盖。
- HTTP 记录中把 H04A 结果归到 H04 的错误由 [既有具名更正](../../evidence/g0-005-http-template-card-h04a-correction-20260922.md) 替代；这次处置不升级任一能力结论，不补造现场证据或授权。

精确清单为 `pr21-evidence-exceptions.json`，每项绑定提交、直接父提交、路径、前后 blob、前后文件模式及变更类型。检查器仍遍历 PR 原始 base/head 间全部提交及每个合并父边，输出实际遇到的已处置项；只有完整匹配的五个历史转换可通过。以后同路径的追加、插入、改写、删除、改名、模式变化及改后恢复仍失败。清单不是路径白名单，不从 PR 输入或环境变量接收豁免。

如果后续 PR 分支从旧 base 同步当前 `main`，同步合并提交会同时包含一条 base 父边和一条旧 PR 父边。检查器只沿 base 侧比较该合并提交，避免把 base 已有的 evidence 带入误报为 PR 改写；分叉合并中没有可识别的 base 父边时，所有父边仍检查。这样更新分支不会抹掉真实的合并侧覆写记录。

不移动 SS009 信任锚或 PR 检查起点，不改写 Git 历史，不修改现有 evidence、r7 或原 SS009 校验器。SS009 的原严格 CLI 和篡改探针继续在 GitHub 已发布 PR #19 固定对象中执行；其通过只证明历史验收可复现，当前工作台回归单独运行。新增测试针对的具体缺口是：一次性历史处置必须通过，而未来同路径变动必须仍被拒绝。撤销处置可移除清单匹配，门禁会恢复拒绝这五次变动。

本地验证（Node 24.18.0）：精确处置测试先 RED 后 GREEN，2/2 测试通过，包含后续五类修改、各自恢复提交及合并侧隐藏覆写；当前工作台/OAuth 回归 56/56 通过。PR #19 已发布 `41edd855e7bc55149facb6a4b2e0076776c22e66` 的独立完整 CRLF checkout 中，原严格 CLI、33/33 证据测试及 r6 篡改探针通过。没有新建 r8、重跑 PostgreSQL/浏览器全量验收或调用企业微信。

以下规则自 2026-09-21 起用于后续工作；上文各修复轮次的运行结果是历史记录。

### 本轮收口

PR #19 在发布 HEAD `0d1cfa2935f028ca5c0a97838615dad1ab453563` 上的 r7 为当前验收依据。GitHub API 确认其直接父提交为 r7 的 `8b74de2eb63ea90e3ca23dabcdbc8f5afdadd7e5`；13 条线程均已解决。对应 [published history 运行](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/35518489329) 的 head/merge 检查通过。这是该提交的状态快照，线程解决不等于 APPROVED，也不表示 PR 已合并。

- 本轮对象错配问题结束修复，不生成 r8，不重绑 tested_head，不修改旧报告中的 remote_review 快照。
- 对重复意见，先核对意见所指发布对象及已有验证范围；已有结果适用时引用其结论。只有新的可复现缺陷或相关内容、依赖、环境及历史发生变化时，才按影响决定修复和重跑范围。
- PR 描述、讨论及纯文档更新不自动要求完整候选再生成或再次请求机器人审查；已配置的必需 CI 仍正常执行。候选变化仍执行原验收契约要求的检查，不能用局部测试冒充完整验收。
- 合并时保留被测祖先，使用保留历史的 merge commit；如果仓库策略不允许，先解决合并策略与验收契约的冲突。不得静默改用 squash/rebase 后沿用失去祖先的证据。合并仍按用户授权执行。

### 后续独立减量工作（待实施，不阻塞本 PR）

目标是减少原始产物的重复存储，保持历史可验证和业务行为不变。仅调整证据生成、存储和读取，不夹带业务重构，不新增治理平台或多层状态机。现有受保护 evidence 文件及 Git 历史保持原样，先对未来运行采用新格式；若要迁移旧产物，另行明确兼容契约后执行。

1. Git 保留业务/测试源码、必要固定夹具和精简 manifest；manifest 记录运行标识、被测 SHA、候选摘要、结果及限制、原始制品位置、大小和 SHA-256。报告引用同一份原始回执，消除 TAP、capacity.records、cleanup.receipts 的重复内嵌。
2. 原始 TAP、事件、容量采样、截图和诊断按运行归档。实施前确定存储位置、访问权限、责任人、保留期限及备份/恢复方式；正式验收不能只依赖会过期或随运行删除的 Actions 链接。敏感信息继续脱敏并限制访问。
3. 校验器保留旧格式读取，新格式校验制品可取回、摘要及原有结果绑定。制品缺失、损坏或无访问权限时明确失败，不回退为 PASS。先验证独立取回和恢复，再切换新运行的产物写入；失败时可恢复原写入方式。
4. 验收比较同一代表性运行的新旧产物：Git 新增字节和重复回执数量减少；旧报告仍可验证；独立取回、校验和恢复成功；业务风险覆盖与结果不变。只保留一次简短对比及必要制品，不为减量再建立重复证明链。

权限隔离、幂等、事务中断恢复、升级保护、部分写入回滚和报修不丢失等风险测试继续保留。新增校验须说明具体失败场景、现有覆盖缺口和停止条件；仅有新的机器人评论或测试数量指标不构成扩建理由。

### 后续交付顺序

先按现有证据收口 PR #19，再在明确任务范围内推进业务交付及上述减量。正式自然 GC、真实 2C4G、60 分钟现场仍属未完成验证；自动化 PASS 不能替代现场结果。SS-010 保持 PLANNED，SS-011 保持 NOT_AUTHORIZED；本次调整不启动它们，不推进父 Gate，不授权真实发送、部署或生产数据访问。
