# v2.1.3 卡22本地证据（R1–R6）

[执行记录](../../../../plans/pc-admin-design-v21/card-22.md)。基线 `6e2553888f0923248827173fa54ef2456d2c0cae`，未提交候选；Node 24、PG18、自有 loopback 合成库、系统 Chrome，截图缩放1。正式参考仅01–05及04b；没有使用06–08。

本目录来自 `D:/CodexEvidence/pc-admin-v213-card22-20261104/direct-4/` 的4/4浏览器断言（3个新增场景及原未接待场景）；原始字段测量位于该外部回执目录中的 `board-metrics.json`（工作台）、`conversation-metrics.json`（会话）、`notification-metrics.json`（通知异常）。这些是本地原件位置，不作为仓库内可点击链接；可移植的数值表与截图见下文。候选输入 SHA-256 `2186a3598a76d54c182e72eee3188e94eb30c9d04e6e56db7fbbb8f853a1270f`，manifest SHA-256 `35670741c5c569143f08d19f31f469e9af20cc32d6b04fef574e8f7858d56397`。旧截图继续证明其原候选，不重绑身份。

## 1920 / 1440 前后对照

| 页面 / 宽度 | 改前（原卡20 / 卡21，保留原件） | 改后 |
| --- | --- | --- |
| 工作台1920 | [卡20](../v212-card20/board-1920.png) | [R1/R2/R5](board-1920.png) |
| 工作台1440 | [卡20](../v212-card20/board-1440.png) | [R1/R2/R5](board-1440.png) |
| 抽屉1920 | [卡20](../v212-card20/drawer-pending-1920.png) | [R1/R2](drawer-1920.png) |
| 抽屉1440 | [卡20](../v212-card20/drawer-pending-1440.png) | [R1/R2](drawer-1440.png) |
| 会话1920 | [卡21](../v212-card21/conversation-1920.png) | [R1/R3/R4/R5](conversation-allowed-1920.png) |
| 会话1440 | [卡21](../v212-card21/conversation-1440.png) | [R1/R3/R4/R5](conversation-allowed-1440.png) |
| 通知异常1920 | [卡21](../v212-card21/notifications-data-1920.png) | [R5/R6](notifications-1920.png) |
| 通知异常1440 | [卡21](../v212-card21/notifications-data-1440.png) | [R5/R6](notifications-1440.png) |

新工作台包含 R2 a–e 场景，抽屉打开处理中 b，原抽屉是待处理场景；两者不是同一业务状态的像素差分。最新 main 已经包含 N3 投影，所以新通知列表保留真实工单号/标题及报修人，不以旧图要求删除它们。

## 新增场景与头像局部

- R2：[1920已超时激活看板](board-overdue-1920.png)，数字2、待处理a与处理中b均可见；另有真实 review 红卡的计数/集合断言，见工作台测量。
- R1：2倍浏览器截图裁剪：[卡片处理人](avatar-board-owner.png)、[抽屉处理人](avatar-drawer-owner.png)、[侧栏账号](avatar-sidebar-account.png)、[会话头部](avatar-conversation-header.png)。完整原名仍在 aria-label/title。
- R1现状说明：会话输入区实际没有 Avatar DOM（浏览器测得0），故没有虚构输入区头像；提供真实[可回复输入区局部](conversation-composer-allowed.png)与[无权限输入区局部](conversation-composer-denied.png)，并以会话头部作为该页 Avatar 局部证据。
- R3：[跨日与合并分隔线1440](conversation-dividers-1440.png)。DOM依次为「昨天」「今天 · 切换到 Bot 私聊」；日内追加群聊后再有「切换到 群内原始消息」。前两项 margin 8px / 20px、左右横线1px及颜色完全一致。
- R4：[无回复/备注权限1440](conversation-denied-1440.png)、[1920](conversation-denied-1920.png)；侧栏「只读」但获准回复的对照见上述 allowed 截图。disabled、原因、颜色、字数和发送按钮均有断言。
- R5：三页工具栏：[工作台](toolbar-board-1440.png)、[会话](toolbar-conversation-1440.png)、[通知异常](toolbar-notifications-1440.png)。
- R6：[900初始位置](notifications-900.png)、[900滚动到右侧](notifications-900-scrolled.png)。实际滚动距离大于0，行内容 nowrap、没有相邻单元格重叠。

## R5：1440 getBoundingClientRect 实测

同一行所有 chip 均测量；表中列出 top/bottom 的共同值，单位px。名称和值只测实际 trigger 内的可见文字，无障碍标签不参与几何比较。

| 页面 / 状态 | chip 高 | 搜索框高 | chip top / bottom | 搜索 top / bottom | top / bottom 差 | 文字中心最大误差 | × 高 / 中心误差 |
| --- | ---: | ---: | --- | --- | --- | ---: | --- |
| 工作台未生效 | 32 | 32 | 161 / 193 | 161 / 193 | 0 / 0 | 0 | 不适用 |
| 工作台生效 | 32 | 32 | 161 / 193 | 161 / 193 | 0 / 0 | 0 | 24 / 0 |
| 会话未生效 | 32 | 32 | 108 / 140 | 108 / 140 | 0 / 0 | 0 | 不适用 |
| 会话生效 | 32 | 32 | 108 / 140 | 108 / 140 | 0 / 0 | 0 | 24 / 0 |
| 通知异常未生效 | 32 | 不适用 | 132 / 164 | 不适用 | 不适用 | 0 | 不适用 |
| 通知异常生效 | 32 | 不适用 | 132 / 164 | 不适用 | 不适用 | 0 | 24 / 0 |

通知页本来无搜索框，用户确认不新增功能；没有创建替身搜索控件。触屏高度继续沿已有 `--control-h-md` Token，未另改页面覆盖。

## R6：getBoundingClientRect 实测

宽度单位px，保留两位小数；断言使用原始浮点值。列顺序保持结果、关联来源、通知类型、接收人、渠道、时间、操作。

| 视口 | 表宽 | 结果 | 关联来源 | 通知类型 | 接收人 | 渠道 | 时间 | 操作 | 来源占比 | 滚动容器 client / scroll |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1440 | 1136 | 120 | 171.27 | 285.45 | 171.27 | 120 | 140 | 80 | 15.08% | 1136 / 1136 |
| 1920 | 1376 | 120 | 236.72 | 394.55 | 236.72 | 120 | 140 | 80 | 17.20% | 1376 / 1376 |
| 900 | 928 | 120 | 140 | 160 | 120 | 120 | 140 | 80 | 15.09% | 868 / 928 |

通知类型是最宽的弹性列；工单和会话图标均实测14px；来源链接左对齐/单行/`--text-link`，通知类型省略且 title 等于全文。已有 N3 字段原样使用，没有父事项逐行请求或前端拼凑。


## 最终补验与资源（2026-11-05）

最终同候选29入口178/178 PASS，0失败/取消/SKIP/TODO，NOT_RUN为空。最终build、types（含Stylelint/ESLint）和verify-artifact通过；20个文档工具用例通过。原始报告在外部回执根 `selection-local-final/`，不把定向4例与178例相加。

R4恢复提示开启的未接待900场景：[最终截图](conversation-waiting-900.png)。`getBoundingClientRect` 实测消息区 **545.78125px ≥ 540px**，文本框48px，原因行上下margin均0px，提示「领取接待后可回复」可见且输入禁用。原失败525.78125px及原断言保留；补验没有降低门槛。

共24张截图均有字节/hash来源清单。所有合成库沿helper清理（仅剩postgres）；PG停止exit0、status3，54822无监听，自有进程0。工作树、分支、静态证据及PG数据目录保留。
