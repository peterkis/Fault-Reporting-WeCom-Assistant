# YXX-SS-008 本地组装完成

SS-007 已完成。v33 发布时仍待审，PR #17 最终提交获得无重大问题结论、审查线程清零并合并后，台账未同步。本次新增完成态核对记录并修正台账；未改写 v33 或其他历史报告。

SS-008：**COMPLETE**。完整回归 **1154/1154**，183 个测试文件，历史 171 文件全部保留；fail/cancelled/skipped/todo 均为 0、exit 0、候选不变。8 个验证器和两轴独立审查均 PASS。

## 候选绑定

- 分支：`codex/yxx-ss-008-assembly`
- 执行基线：`2d9fda2065b1303620f247a9e4d9754f0a3472d9`
- 测试/审查 HEAD：`7f4e09df6da3ff661f68d1dbe239ce8851be8842`
- 测试 tree：`71b814ce06bb8144839640bf1be2d795e22a512d`
- 候选指纹：`511d07e086ac78f1890399db840473a7b23c46d3f34ed2658279bfcd50bd071b`；660 个候选文件。
- 最终证据发布提交仅更新 Evidence/任务台账，其 SHA 在交付回复中给出，避免循环引用。

## 实际完成

七个原生 API 按精确路径优先于旧 OAuth/Reporter 分派；保留根主页有限认证、Ticket 深链接及旧 Grant 桥接。SELF 复用已验证代开发映射和现有 command/store/query，独立 App 的有界泵不依赖 Gateway。FULL App 无 Web 泵，实际原 Worker 子进程处理同一持久待办并正常退出，pool=2。原三进程资源测试保持 4/2/1，控制器单列。

真实隔离 PostgreSQL/HTTP 验证了网页提交→原人工审核→原 Ticket→坐席接单/处理/解决/关闭→本人查询；同一 Ticket 未被复制。真实浏览器确认原工作台显示网页原始描述、位置、补充内容，并在无 Conversation 时明确显示聊天不可用。四来源在当前 033/034 schema 共存；本轮没有新增或改写迁移。

T_accept 先提交来源/受理/回执，T_process 后规则/审核/Core。同命令不重复，补充与审核保留共享根锁及版本围栏。My reports 仅本人 Web Request 与安全授权的本人 Bot Ticket；Web 成单只显示一项。关闭写开关后已批准读和命令查询继续；成员 Cookie 不获得坐席角色。Web 生命周期外部 Message/Outbox/Delivery/Grant 为 0，旧 Bot 通知与 UNKNOWN 边界保留。

提交后身份变化回归发现并修复了回执泄漏窗口：两条 POST 路径比较原/最新 recovery_scope 与 CSRF；变化时抑制旧回执，已提交事实保留，不声称回滚。

## SS-008 验收矩阵

| ID | 要求 | 结果 |
|---|---|---|
| YXX-AC-073 | 真实网页到原坐席再到本人 | PASS |
| YXX-AC-074 | 旧三入口回归 | PASS |
| YXX-AC-075 | 四来源独立 lineage | PASS |
| YXX-AC-076 | 无 Conversation 的原工作台 | PASS |
| YXX-AC-077 | SELF 唯一 App 有界泵 | PASS |
| YXX-AC-078 | FULL 原 Worker 所有权及角色资源 | PASS |
| YXX-AC-079 | READONLY / OAuth-only 隔离 | PASS |
| YXX-AC-080 | Web 全生命周期 APP_ONLY、旧 Bot 通知 | PASS |
| YXX-AC-081 | 原锁顺序与身份/错误边界 | PASS |
| YXX-AC-082 | 关写不停本人查询 | PASS |

逐项实际测试名称、测试文件摘要和全量运行引用见同名 JSON；不是从计划矩阵复制 PASS。

## 失败与必要修复

首次完整回归为 1153/1154，唯一失败是旧 SS-003 测试直接使用配置数据库且未准备 032。自有临时数据库上的 through-031 复现得到了同一 REQUIRES_032。仅修复测试夹具：隔离建库、原基线准备、严格 APPLIED/NOOP 与清理；运行时代码和迁移未变，原业务断言保留。定向 2/2 后重新运行原完整入口。本次及此前失败/中断 TAP 均保留，未提高超时、删除业务断言或缩小规模。

## 十二张任务状态

| 任务 | 状态 |
|---|---|
| YXX-SS-000 | COMPLETE |
| YXX-SS-001 | COMPLETE |
| YXX-SS-002 | COMPLETE |
| YXX-SS-003 | COMPLETE |
| YXX-SS-004 | COMPLETE |
| YXX-SS-005 | COMPLETE |
| YXX-SS-006 | COMPLETE |
| YXX-SS-007 | COMPLETE |
| YXX-SS-008 | COMPLETE |
| YXX-SS-009 | PLANNED |
| YXX-SS-010 | PLANNED |
| YXX-SS-011 | NOT_AUTHORIZED |

## 保护与停止线

时间遵守 Asia/Shanghai 秒文本及 epoch 字符串；新增 JSON 记录使用同一次采样生成 event_time/event_epoch_ms。测试候选、源码清单与审查绑定同一指纹。自有测试数据库、Worker、浏览器和临时 worktree 按夹具清理；原始完整运行目录和全部 Evidence 保留。`.gitignore` 字节 SHA-256 与 index blob 均不变。

父 Gate 未 PASSED；last_completed_task=P2-012、last_completed_gate=P2-G1、last_completed_architecture_task=ARCH-006。SS-009/010 尚未作为任务执行，SS-011 未授权，P2-G2-LIVE 未启动，P2-008 继续阻断，持久开关默认 false。无当前父 Gate --require-ready、正式自然 GC/2C4G/60min 或现场验收结论。

后续 SS-011 必须先完成 SS-009/010，再单独批准候选、部署/DDL、限定成员和写入范围、时间窗口、停止/回退及清理责任。

**未操作厂家/云端/nginx/SSH，未真实 OAuth/SDK/生产或医院业务数据，未真实发送，未 P2-G2-LIVE/AI/OCR/RAG/内网/P3，未 push/PR/merge/tag/release。**
