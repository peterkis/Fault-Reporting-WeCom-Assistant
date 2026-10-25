# 迁移后剩余失败修复记录（2026-10-24）

状态：实施中。范围来自用户明确要求实施的剩余失败修复计划：原39个业务失败、8个工具失败、rename NOT_RUN及3项额外诊断失败。工作树为 `D:\worktrees\pc-admin-app-layout\Fault-Reporting-WeCom-Assistant`，分支 `codex/pc-admin-app-layout`；不提交、推送、合并、部署、真实发送或推进Gate。所有新文件和资源位于D盘。

原05迁移和失败记录见[迁移交付](server-migration-2026-10-23.md)。原件及32次对照不改写；新证据目录为 `D:\fr24`，逐项台账起点为 `failure-ledger-01.json`。当前HEAD仍为 `d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f`，不能用它冒充未提交修复的被测提交。

## 优先差异

### T35 Session UNKNOWN

独立副本保留原host、flags和断言，记录了首POST时的真实视口、正文矩形、focus、visibility及文档身份。旧基线首次观察也发生2/预期1，两条正文均完整可见；当前05首次观察通过时仅第一条正文已加载。这证明原测试未建立第一条独立可读的前提，原单次双侧差异不能直接归因源码迁移。

首坐标用例改用真实160px高视口，并在显示前核验第一条完整、已存在的第二条尚未完整。没有删除、筛除或改变生产材料，也未把原坐标1放宽。增加两条正文完整可见时合法提交2的独立用例；两者均执行真实COMMIT后丢ACK、GET核对原坐标、不以新UUID重发及其他主体/Session/Source不变断言。

中间诊断原件保留：`t35-candidate05-first-only-01`曾因额外全局投影断言6/0失败；`t35-baseline-first-only-01`等待并不保证存在的第二条正文失败。正式修复没有使用这两项额外前提。相关副本、注入和原件哈希位于 `D:\fr24\diagnostics`；它们不计正式验收。

### T29 purpose-loss

观测记录证明了两种合法顺序：targets真实403先返回时原用例可以通过；Incident先返回HANDLER后，组件清理用途并取消在途targets，fetch以AbortError拒绝，旧hook因只记录Response而没有403。真实403在HTTP发送前暂缓的诊断及自然迟到200场景均复现了取消链。

正式用例分别验证真实403先返回、真实Incident先返回并原生取消targets、自然并行以及旧200迟到。响应门只暂缓真实响应；未伪造权限/状态码，生产刷新和即时失权清理保持原逻辑。每项核验一般Session/Incident仍可读、交接POST为0、版本1和旧响应不能恢复输入。浏览器观测保存请求开始、Response、abort、reject及文档身份；首次cleanup失败与后续无残留继续分开记账。

### 定向验证

开发候选manifest `7bac8f269fb66fb990d4fc18d71a63b7ed21a7042c221067ba83160471a22a31`，输入 `1152ee4be2c314df294df63b47c4e3ebd781872dc95c4cd1de26db507a7247f1`：严格编译/构建通过；两个注册入口每轮6项，连续8轮48/48 PASS，无skip/cancel/todo/not-run，每轮PG四库/零其他连接。原件索引 `D:\fr24\priority-results-01.json`，冻结运行树 `priority-dev01-runtime`。这是本阶段定向验证，最终全部入口另在最终候选执行。

## 当前合同与后续批次

用户已批准前向修订，见[ADR-0045](../../adr/0045_versioned_current_readiness_scope.md)。新版本精确绑定49份SQL、六个状态文件和默认配置，旧ADR-0027及其scope/acceptance原件保持。合同接线、迁移组合证明、完整740当前+1历史清单、其余夹具/时序/工具失败仍在实施。

## 资源与最终验收

自有PG18独立位于 `D:\fr24\pg\data`、loopback端口52476；所有权回执为 `D:\fr24\pg\owner.json`。原52474/52475数据与日志未启动或修改。最终完整注册集、工具、正式bundle/开发入口、保护文件和资源收口尚未完成；不能据当前结果宣布READY或整体通过。
