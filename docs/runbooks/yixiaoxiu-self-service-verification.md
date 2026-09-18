# SS-009 本地验收

本阶段只生成本地自动化候选，不批准 SS-010、SS-011、父 P2-G2 或真实发送。
开始基线是 PR18 合并后的 `375d47b013017edb858206cc5f3475c9aed77dfd`。
父状态、历史证据和 migrations 001–034 保持冻结，所有持久 Feature Flag 默认 false。

## 入口与绑定

- `node scripts/validate-yxx-self-service.mjs`：结构检查，允许 NOT_RUN，不产生 READY。
- `node scripts/p2-g2-synthetic-e2e.mjs --suite=full`：Node24、隔离本地 PostgreSQL、串行、`--expose-gc`。
- `node scripts/validate-yxx-self-service.mjs --require-ready`：仅在当前报告完整后执行，证明 SS009 本地验收。

完整入口同时输出 TAP 和 Node 原始测试事件的安全投影 `cases.jsonl`；后者包含执行文件、名称、行号、结果及 skip/todo。
两份输出都由 run.json 摘要绑定。场景不得靠另一文件的同名测试、注释、测试文件存在或摘要 PASS 取得通过。
测试源码、SQL、契约及 UI 指纹仍沿用原 candidate inventory；报告和台账不纳入源码指纹以避免自引用。
报告绑定源代码提交和 tree；最后的证据提交不在报告内写自身 SHA。

## 迁移校验修复

SS009 的真实 PG 负向测试证明原片段匹配可接受弱化的 CHECK。
新目录契约从不可变 033/034 分别应用到隔离 032 基线得到，覆盖三辅助表和全部受影响共享表的列、约束、索引及关系属性。
033 中间态与 034 最终态显式区分；不存在“两个快照任一匹配就通过”的最终态降级。
校验器变更不修改迁移 SQL，也不添加新迁移。

## 容量与夹具根因

两个 profile 分别执行 500 报修、2000 补充、100 审核、32 并发读和另一次十二路同命令竞争。
共享规则为高风险明确故障先创建最小 Ticket 并保留人工审核，不应把人工审核项都视为无 Ticket。
数据组为 200 普通明确故障、100 待描述、50 高风险、50 明确要求人工跟进的投诉、100 非报修。
审核对无 Ticket 的 50 项批准成单，对已有最小 Ticket 的 50 项进行审核分类处理；最终另加并发对照受理，总计 501 root、2501 source/receipt、301 Ticket。

早期 FULL 夹具错误使用非 `p2_015_g2…` 名称，Worker 的自有数据库保护拒绝启动；修复仅调整自有库命名。
之后统一 60 秒等待在 FULL 不适用：原 Worker 每 250ms 为 Web 保留一项，500 个 root 的完整处理约需至少 125 秒。
失败时约65秒处理252项、余248项，Worker 健康且 failure_count=0。
独立 SPEC 预审确认采用180秒排空总限加10秒无进展拒绝是夹具修正；整体360秒上限、负载及断言不变。
此结论不是性能 SLA，也不构成2C4G、自然GC或60分钟现场证明。

## 资源与保留

App pool<=4、Worker<=2；未启动 Gateway 时记0，控制器 pool 单独列示。
仅强制终止自有测试子进程或所属隔离库 backend，绝不停止共享数据库服务。
数据库、进程、浏览器和 profile 均由 finally 清理；失败日志、TAP、截图和原运行目录保留诊断。
原始外部身份、真实患者资料或 secret 不进入公共输出；模拟 Provider 调用与真实网络调用分别记录。
