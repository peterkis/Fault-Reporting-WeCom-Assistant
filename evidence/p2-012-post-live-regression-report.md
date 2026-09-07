# P2-012 现场后完整回归

- 日期：2026-09-07（Asia/Shanghai）。
- 现场 Run：`fd4c9d42-dcae-4f63-acdb-7750c747390a`。
- 固定 Runtime 输入指纹：`55b89664e18c761d31b073fc2e279991e8543507b99ef55080d2ed9f6e2e6740`。
- 状态：PASS；负责人已确认客户端可见性并批准收口，见 `evidence/p2-012-project-owner-approval.md`。

实际执行：

```powershell
node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs
```

退出码 **0**：559 tests / 559 pass / fail=0 / cancelled=0 / skipped=0 / todo=0；耗时 `604744.0796 ms`。原始 TAP 为 `evidence/p2-012-post-live-regression.tap`，SHA-256 为 `e10e985330ef98856ebd00dcc29aaecb0b02f748b72d744513468ea8bfdf6004`。

该全量集合没有跳过 Integration、Browser、Sender 或容量用例，继续覆盖 P1、P2-001–007、P2-G1、ARCH-005/006、P2-015、P2-016 与 P2-012。现场真实企业微信证据与自动化覆盖仍分开记录。

回归后只读核验：P2-012 复用的 `p2_015_*` 隔离测试库模式残留 0、backend 0；所属 Node 测试/现场进程 0；43112/43113/43114 监听 0；回归 TEMP 根中的 browser profile 0。TEMP 根 `tmp/p2012-regression-post-live-7aad811a35f8425eb152a5f2b3c9002b` 保留 7 个非 profile 项，不声称文件系统全部清理，也不触碰其他应用或旧目录。

六个现场/现场后 Evidence 文件对本机配置中的 10 个 URL、密码、Secret、Token、Key、HMAC 与目标类敏感值进行了精确匹配，命中 0；扫描只记录计数，不输出原始值。

两名 Reporter 的真实群/私人通知客户端可见性已经负责人确认；该回归仍是批准前快照。完成态账本、最终全量回归和唯一第二个本地提交另行记录，P2-G2/P2-008/P3 继续保持停止线。
