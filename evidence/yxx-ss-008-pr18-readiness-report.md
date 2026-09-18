# SS-008 / PR #18 readiness 修复验证

远端审查指出：FULL 挂载自助扩展后，只有旧基线 032 的数据库也会因 031 标记存在而返回 ready。真实隔离 PostgreSQL/HTTP 测试先复现 HTTP 200（期望 503），随后修复。

现仅在挂载扩展时额外要求 033 与 034 两个标记；任一缺失或查询失败均返回 HTTP 503、base_service_ready=false。未挂载扩展的原 FULL 路径保持不变。测试覆盖两项均缺、分别缺失、恢复及旧路径；迁移源码、权限、发送策略和资源上限未变。

完整入口 node scripts/p2-g2-synthetic-e2e.mjs --suite=full：**1155/1155 PASS**，183 测试文件，历史 171 文件全覆盖，fail/cancelled/skipped/todo=0，exit 0，候选不变。定向装配/身份边界 6/6；8 个验证器和两轴独立复核均 PASS。

- 测试/本地审查 HEAD：`1c448d607ebaabdd62820d06aabfd43194f1cfa1`
- tree：`acec6e0237da2ab204c3fcc3f64b8a476840b598`
- 候选指纹：`2e8bf189a993fda0b087229937a9390d9f6e1c24052ca178f7d0b36cd2de388b`

中间一次夹具用不合法的临时迁移 ID 触发平台 CHECK；改为合法后缀后通过，约束未放宽。所有失败 TAP 和原始完整运行目录均保留。先前报告保持原样，本 JSON 重新绑定矩阵测试摘要和完整运行结果。

本记录只证明当前本地修复与自动化验证。发布时远端复审仍待执行；PR 合并以 GitHub 上当前头的复审结论为准。`.gitignore` 保持原字节；SS-009/010、SS-011、父 Gate、真实 OAuth/SDK/发送及云端停止线不变。
