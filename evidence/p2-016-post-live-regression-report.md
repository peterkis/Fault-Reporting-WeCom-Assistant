# P2-016 现场后最终回归

本报告保留负责人最终批准前的现场后回归快照。后续负责人已批准；最终 DONE 收口见 `evidence/p2-016-project-owner-approval.md` 与 `evidence/p2-016-ticket-lifecycle-workbench-report.md`。下文“待确认/READY/一个提交”均是本快照形成时的事实，不覆盖完成态账本。

- 日期：2026-09-04（Asia/Shanghai）。
- 现场 Run：`3bdbe965-c4df-414b-bd5a-05d5f010ad53`。
- 固定候选：`3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`。
- 状态：全量回归 PASS；最后静态门禁与本轮数据库/进程/监听/profile 清理核验 PASS；负责人最终验收待确认。

## 实际执行

```powershell
node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs
```

最终退出码 **0**：533 tests / 533 pass / fail=0 / cancelled=0 / skipped=0 / todo=0；耗时 `555687.2561 ms`。该全量集合包含 P2-016 Unit/Contract、PostgreSQL Integration 与原生 Browser 测试，不以跳过或缩小集合取得结果；没有把分别列出的子集命令冒称为另行执行。

明确覆盖 P1-005/006/010/012、P2-002/003/004/005/006、P2-G1、ARCH-005、P2-007、ARCH-006、P2-015 和 P2-016。实际原生浏览器用例覆盖桌面/移动端、完整动作/转派/复合接管接单、Manual Review、Reporter 安全/刷新/退出、SSE/轮询、CSRF/XSS、认证过期；这些自动化结果与真实企业微信的人工现场观察分开记录。

本次容量测试：500 Tickets、5000 Events、200 Review resolutions、500 Cards、400 Group receipts、100 Reporter sessions、32 SSE；池 max=4。Heap 峰值 `88286656 bytes`，最后 `19168656 bytes`，分段采样及回落见 JSON；停止后 SSE=0、容量库/连接残留=0，自动化真实 SDK calls=0。不是 24 小时 soak 或真实 2C4G 硬件认证。

## 临时目录与基线

仅为本回归进程设置新的 TEMP/TMP 根目录 `tmp/p2016-regression-final-e239f28ed5974ad9a98ce58e6af566b8`，结束恢复原环境。不会让既有浏览器 helper 的 stale-profile 清理触及先前被策略阻止删除的路径。旧根目录/旧 profile 未重试删除；非 profile 临时根目录保留，不声称完整文件系统清理。

`evidence/p2-016-automated-readiness-report.json` 保留现场前自动化快照，新的现场和现场后回归事实由本报告与 `evidence/p2-016-targeted-live-validation.md` / `.json` 承载，不改写旧失败/中断记录。

## 停止线

文档与 Evidence 更新后，默认 P2-016 Validator 142 项通过（readiness_evidence_checked=true，候选指纹不变）；V1.4 Validator 395 项、V1.4 测试 16/16、ARCH-005 所有禁止计数 0、ARCH-006 260 项通过；`git diff --check` 通过。

最终只读与 OS 核验：现场库/连接 0，测试库命名模式残留/连接 0，范围内 Node 测试/现场进程 0，本轮浏览器进程 0，43116/43117 监听 0，最终回归 browser profile 0。回归根目录保留 7 个非 profile 项，不再尝试删除旧策略阻止的路径。`.env.example` 18 个显式 Flag 全 false；`.env.pilot` 3 个显式 Flag 全 false，其他缺失值按已验证的默认 false；无三个现场审批变量。原配置库只读状态仍为 `P2_016_REQUIRES_030`，没有被迁移。

对当时 145 个改动/新增工作树文件进行配置敏感值精确匹配检查，5 个长度至少 6 的配置值命中为 0；原始值没有输出。冻结 migration 001–030、P2-007 Runtime、历史完成 Evidence、`.env.pilot` 与 archive 路径没有本任务 diff。HEAD 仍为授权提交 `3599fa479c752ed75cd4652e5ffdaee2b212ad24`，相对 origin/main 只有 1 个本地提交，索引为空，实施变更未提交。

负责人尚未明确批准本轮 P2-016 targeted live validation；仍保持 READY，不创建第二提交、不标记 DONE、不启动 P2-012/P2-G2/P2-008，不 push/PR/merge/tag/release。
