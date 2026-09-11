# P2-G2 当前自动化就绪报告

**READY_FOR_LIVE_E2E；完整服务闭环现场未运行，Gate 未批准。** P2 保持 IN_PROGRESS，最后完成 Gate 为 P2-G1，P2-008 保持阻断。

## 当前候选

- 源码提交：`a03e7ad141777537207902124b32d2ce2e30445c`；冻结起点及迁移依据仍为 `8c332710dad9b6cf3f6796f3344c04d1c710ddf3`。
- 候选指纹：`64c5a08a11bb4d140b02cf0c5e43758ea57d01e76f6bfaa3b34f819c188d249e`，577 个文件，算法 SHA256_SORTED_PATH_CONTENT_UTF8_LF。
- 完整回归 **976/976 PASS**，158 个测试文件；fail/cancelled/skipped/todo 均 0、退出 0、运行期间候选未变。覆盖冻结 577 项参考基线的全部 92 个根目录测试文件及 P2-007 子目录。
- 命令：`node scripts/p2-g2-synthetic-e2e.mjs --suite=full`。原始运行目录：`tmp/p2-g2-tests-c55091e1-f73b-4e24-9de2-284193343c56`。
- TAP：`evidence/p2-g2-pr7-regression.tap`，SHA-256 `876314b240cc2b25022840ce198c6bc0e6d73f1634ddbf176ad63d282492c626`。
- 环境：Node 24.18.0，Windows 10.0.26200/x64，PostgreSQL 18.4，Edge 152.0.4191.66；使用 --expose-gc，不据此声称自然 GC 60 分钟通过。

## 同候选证据

当前证据入口以 JSON 的 source_evidence 为准：完整运行记录、源清单、202 条来源执行审计、37 个场景矩阵、10 条 PR #6 修复约束、分类指标和 SPEC/STANDARDS 独立审查均重新绑定。两轴 PASS、未解决项 0；它们不是负责人现场批准。

来源分母仍为 122 条正常输入与 80 条机制/其他引用。原202条语义并非全部相同：D12-005 缺可靠非@标志；D12-023 医院主身份属 P3；D12-016 使用 URL Grant 替代卡片事件；D12-053 使用 Outbox 替代回调；关联窗口维持冻结 120000ms。不能将覆盖率写成分类准确率。

`p2-g2-pr7-classification-metrics.json`逐个重新验证当前通过诊断中的实际分类与 Ticket/Review 计数，沿用冻结标签、分母及公式。原标签一致 59/106（55.6604%），裁定后单标签 71/71、集合可接受 34/34；实际可测的审核率 27/109、自动建单率 88/109，缺失与不可比较项目明确保留，不外推全部122条。

## 范围和历史

无应用 Schema 或迁移变更，001–032、依赖锁和原始语料保留。默认业务 Feature Flag 为 false；测试只用隔离 PostgreSQL、回环 HTTP、模拟 SDK 和实际本机浏览器，AI/OCR/RAG 调用为 0。App/Worker/Gateway 与连接池、SSE 等原资源上限不变；完整 2C4G 60 分钟现场观察尚未执行。

旧954项就绪报告保留在 `p2-g2-pre-oauth-readiness-report.json/md`，旧来源文件不覆盖。PR #7 曾发现的完整回归失败、误报判定和修复 chronology 见 `p2-g2-pr7-review-remediation.md`；不将失败运行计为就绪证明。

现有云端完整 G2 包仍为不可变的 `prep-17ebc9bc8862-e12a6d4b` 停止态快照，未部署当前完整 G2 候选。独立 OAuth-only 入口已完成真实成员认证，见 `p2-g2-wecom-web-oauth.md`，不等同于完整服务闭环现场完成。

PR 发布及合并依据2026-09-11用户单独授权。真实业务发送、现场写库、60分钟观察和负责人 Gate 批准仍须当前候选的独立许可；不启动 P2-008、P3 或生产/临床上线。较早受保护的浏览器临时 profile 和历史日志继续保留，未进行广域清理。
