# Card 27B / B5 独立审查修复证据

2026-11-06，Windows Chrome；全部为本地合成场景。审查使用 code-review 的独立 Standards / Spec 两轴，加上 open-code-review-delegate 的独立 OCR 委托审查。OCR CLI 只提供文件选择和规则，没有调用远端 LLM。原 17 图、两个阶段的候选、失败与 NOT_RUN 保持原样。

基点/HEAD 为 `4a279a2a42c8eec84a97c6191f2d18da4836df30`，实际对象为完整未提交工作区及未跟踪文件；没有用空提交区间替代差异。初审 61 项各自覆盖 61/61、0 skipped，含 28 项 OCR 原生规则与 33 项人工补审。

## Standards

初审 0 硬违规、1 项 P3 possible Duplicated Code：两种卡片的 metadata JSX 重复。修复为单个卡片局部 JSX 值。源码复核 61/61，0 硬违规、0 新增判断项。最终独立报告由该轴审查者归档；下方运行结果另行绑定修复候选。

## Spec

初审与源码复核均 0 项可行动问题；日期、结束方式、q 草稿、视图切换、原业务权限和停止线保持。各阶段覆盖 61/61，0 skipped；最终独立报告分别核对运行证据及新增文件，不把旧 459 项绑定到新制品。

## OCR 委托

初审 1 项 medium `OCR-M01`：连续日期/结束方式切换会在上一服务端搜索仍在执行时发起下一次请求，触发 429 并进入错误视图。原制品真实 HTTP/PG 复现已单独保存；修复用同步条件提交锁和查询 fetching 态，保留原并发预算及超时。q 草稿仍可编辑，视图切换沿用已接受条件，写入阻塞独立。源码复核未发现新增问题，运行闭环如下。

## 修复回归

正式用例 `Card 27B pending searches lock date and closure controls until the genuine server read settles` 使用既有 fixture 写法，在真实窗口 SQL 执行前保持门闩，不伪造响应或更改超时。新用例通过，PC 浏览器入口合计 16/16；原 15 项保留。

| 观测 | 实测 |
| --- | --- |
| 在途控件 | 四日期按钮、自定义入口、结束方式、提交、结束搜索、刷新及概况禁用；q 可输入。 |
| 真实禁用交互 | 点击 7 个入口后无第二个搜索，URL 保持，无 429；切至看板仍沿用原在途查询。 |
| 释放后 | 今日已关闭 3 项、改已完成 4 项；控件恢复，q 草稿保留。 |
| 请求与业务事实 | 3 次实际搜索均 HTTP 200；业务 POST 0；Ticket 状态、版本、责任和事件守恒。 |
| Windows 截图 | viewport 1440×1060，DPR 1、zoom 1，Win32；工具栏裁片 1152×137。 |

![真实搜索在途时的读取工具栏](search-controls-locked-1440.png)

[原始回执](receipt.json)按原字节保留，截图 SHA-256 为 `8b7270c4d14e6a0ab9b76d7485117a5e5af89b524b42f2ec17067cc7fa358dbc`。回执的 file 指向原采集临时目录，仓库截图是该文件逐字节复制。

新源码输入 `7d6178c805f63b1b72b3be360f9ffa84b6abd1f69d98f7b7038b200064f486df`，manifest `0c16bdb41e3a7c1882de4298f082158cbcea03463df43d19c9e46419084c6c67`。本轮完整路径计划 **65/65 入口、460/460 PASS**，FAIL/CANCEL/SKIP/TODO 均 0，NOT_RUN 空。migration:build、gate types、Stylelint、既有功能区 ESLint、契约语法、文档链接/预算和文档工具 20/20 均通过；制品终核为 ARTIFACT_VERIFIED_NOT_ACTIVATED。

资源：110 份实际 Job 关闭回执均为 0 个活动进程，17 个原生 helper 编译缓存身份通过；首次资源观测把编译缓存误作 Job 的错误已保留并校正。PG 已停，停止前仅三个基线数据库、其他客户端 0；测试端口监听和任务进程均 0，数据与临时目录保留。

外部原件目录：`D:/CodexEvidence/pc-admin-v217-card27b-review-20261106/`，包括初审、源码复核及最终独立报告/覆盖清单、OCR 原件、固定快照、`overlap-before.{json,log,png}`、构建/类型与本批测试报告、两次资源观测。原 RED、之前两个阶段的失败和缺口均未覆盖。最终清单为 64 项，OCR 原生规则 29 项、人工补审 35 项，均由各审查轴独立交代覆盖。

没有提交、推送、创建 PR、CI、full/certify、真实发送、现场业务写库、部署或 Gate 结果。S1 统一关闭原因/原单关联和 S3 恢复仍按原停止线处理。
