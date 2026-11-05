# v2.1.4 卡23本地证据（V1–V14）

[执行记录](../../../../plans/pc-admin-design-v21/card-23.md)。2026-11-05，基线/HEAD为6d2e7411b7bea189f6e1bf23382f52fc5a300e56，独立未提交工作树；Node 24.18.0、PG18、系统Chrome、loopback真实HTTP、UUID合成库，缩放1。截图与直接断言绑定本轮最终制品，不构成现场接受、发送、部署或Gate批准。

最终源码输入SHA-256：7e1235dd51c905a534e675f5ec983148788b66cfddf41a614d30d3092ec6d35b；manifest SHA-256：9582e8db3254b0970761837989366f92805b8f6fc3f9cd1b4503690ee6b38094。原始TAP、JSON矩形与截图来源/hash清单仅保存一份于 D:/CodexEvidence/pc-admin-v214-card23-publish-20261105/。

正式参考仅原型03（01/04辅助），06–08排除。对照源为[原型03](../v212-card21/offline-reference/03-conversation.png)和[卡22原证据](../v213-card22/README.md)，不修改历史截图或将旧结果重绑本轮。

## 前后对照

会话改后四状态×三宽均齐全；通知1440齐全。卡22目录缺少7组指定状态/宽度的改前原件，下面逐格标明缺口；没有用其它状态、宽度或重建截图冒充原件。合成数据与消息滚动位置不同，这些是视觉对照，不能声称整页像素差分为零。

| 状态 / 宽度 | 改前：卡22原件 | 改后：卡23 |
| --- | --- | --- |
| 可回复 / 1920 | [原图](../v213-card22/conversation-allowed-1920.png) | [新图](conversation-allowed-1920.png) |
| 可回复 / 1440 | [原图](../v213-card22/conversation-allowed-1440.png) | [新图](conversation-allowed-1440.png) |
| 可回复 / 900 | **缺原件** | [新图](conversation-allowed-900.png) |
| 无权限 / 1920 | [原图](../v213-card22/conversation-denied-1920.png) | [新图](conversation-denied-1920.png) |
| 无权限 / 1440 | [原图](../v213-card22/conversation-denied-1440.png) | [新图](conversation-denied-1440.png) |
| 无权限 / 900 | **缺原件** | [新图](conversation-denied-900.png) |
| 待接待 / 1920 | **缺原件** | [新图](conversation-waiting-1920.png) |
| 待接待 / 1440 | **缺原件** | [新图](conversation-waiting-1440.png) |
| 待接待 / 900 | [原图](../v213-card22/conversation-waiting-900.png) | [新图](conversation-waiting-900.png) |
| 含发送失败消息 / 1920 | **缺原件** | [新图](conversation-failed-1920.png) |
| 含发送失败消息 / 1440 | **缺原件** | [新图](conversation-failed-1440.png) |
| 含发送失败消息 / 900 | **缺原件** | [新图](conversation-failed-900.png) |
| 通知异常 / 1440 | [原图](../v213-card22/notifications-1440.png) | [新图](notifications-1440.png) |

无权限对照图沿卡22同一recovery:false合成配置（真实capabilities不含REPLY/INTERNAL_NOTE），通过capture-denied-fix.mjs三宽复测；未改生产配置或隐藏业务反馈。fix-direct-3另完整覆盖recovery:true，其原图保留既有权限失效草稿安全提示；原始JSON/TAP与原图均在外部回执根。允许、待接待、失败与底栏草稿局部来自恢复开启场景。

## 两倍局部（浏览器原生clip，scale=2）

| 局部 | 截图 |
| --- | --- |
| 联系人列表项 | [2倍](detail-contact-x2.png) |
| 会话头部 | [2倍](detail-header-x2.png) |
| 带头像的连续消息组（两条） | [2倍](detail-message-group-x2.png) |
| 发送失败消息 | [2倍](detail-failure-x2.png) |
| 输入区底栏：已保存草稿、快捷键、发送 | [2倍](detail-composer-bottom-x2.png) |
| 等待横幅 | [2倍](detail-waiting-x2.png) |
| 右栏报修人 | [2倍](detail-reporter-x2.png) |

## getBoundingClientRect实测（px）

允许±1px的项目均使用原阈值断言；排队状态与时间top差沿Prompt的≤2px。字号/字重/颜色以getComputedStyle补充，未以截图替代断言。

| 宽度 | 中间对话栏 | 右栏 | 姓名scrollWidth / clientWidth | 值右缘→箭头左缘 | 主题选择器宽 |
| --- | ---: | ---: | --- | ---: | ---: |
| 1920 | 736 | 320 | 112 / 112 | 6 | 280 |
| 1440 | 544 | 264 | 112 / 112 | 6 | 212 |
| 900 | 860 | 隐藏 | 112 / 112 | 6 | 252 |

| 验收项 | 三宽实测 / 断言 |
| --- | --- |
| V2 trigger布局 / MessageSquare | flex；箭头static，间隔6；图标14 |
| V3 头部高 / 栅格列间距 / 头像 | 60 / 12 / 32 |
| V3 姓名 / 科室字号 | 14px / 600；12px，姓名无省略 |
| V4 排队状态top−时间top | 2 / 2 / 2（1920 / 1440 / 900） |
| V4 失败 / 待核实位于气泡下方 | 每条footer top≥气泡bottom；图标12；颜色分别等于danger-fg / attention-fg |
| V4 已发送 | meta内12px CheckCheck；aria-label准确；无可见文字或下方footer |
| V5 头像 / 头像→气泡 / 头像top−meta top | 24 / 8 / 0；两侧位置均测，outgoing为row-reverse |
| V5 姓名→中间点 / 普通间距 / 连续间距 | 4 / 16 / 6；第二条无头像/meta，24px占位 |
| V5 气泡字号 / 行高 / 内边距 / 圆角 | 14 / 22 / 8 12 / 8 |
| V6 Send / 页签锁 | 14 / 13；可提交时快捷键显示，禁用时隐藏 |
| V7 无权限原因→发送按钮中心差 | 0 / 0 / 0；原因12px，锁13px |
| V7 待接待 | 重复原因clip-path隐藏；aria-describedby指向文本保留，disabled为true |
| V8 草稿 | 空闲状态无孤立图标；真实输入后「草稿已保存」与字数同行 |
| V9 Clock / Headset | 16 / 14；横幅无资料未提供后缀，无伪造等待时长 |
| V12 标题→内容 / 区块间距 | 8 / 24，三个区块逐一断言 |
| V12 人物头像 / 人物间距 / 姓名字号 | 32 / 10 / 13px 600；科室12px省略 |
| V14 表头左右边框 | th、before、after均0；after content:none / width:0 |
| V14 表头底线 | thead tr为1px border-hair；尝试次数保持1/2/3次 |

## 直接行为与字段断言

- V1：8项日期单测涵盖今天、昨天、今年、跨年、上海午夜两侧与年界；列表浏览器值为今天09:35、昨天、10-21，title与ISO dateTime保持。
- V1 / V9：ConversationInboxEntry/ChatEntry没有等待起点；不使用latest_activity_at或created_at替代。V13：page只有items/next_cursor，unread_count为逐联系人数据，不计算全局总数。
- V4：四状态在同一真实会话；补充三轮四路投递优先级，每轮所有data-delivery-id与实际DTO集合完全相等，其余各路状态保留在title。
- V5：报修人2分钟合并；USER恰好5分钟合并、5分1秒分开；缺少稳定人工作者ID的消息不按同名合并；分组中的排队状态仍在本条meta。
- V10：系统事件原文保留句号；显示为「已记录现场检查进展（合成） · HH:mm」。
- V11：待接待warning点、接待中·我/接待中brand点，真实三种assignment_summary分支；未改状态值。
- V12：卡片与新增链接使用同一openSummary，仍打开原当前页摘要抽屉；reply_channel_label为三行说明中的值，不可交互。
- V6/V7/V8：占位无Ctrl；原UUID/发送与核对控制器不变；展示交互、输入保存、摘要抽屉均未产生业务POST。
- 通知表头竖线来自HeroUI .table__column::after装饰元素。其余共享DataTable消费者为SourceGroupDirectory与IncidentCandidates，均未使用ColumnResizer/Resizable；共享规范只要求水平发丝线，删除的是装饰竖线。

截图尺寸、来源路径与SHA-256见外部screenshot-inventory.json；矩形原件为fix-direct-3/card23-conversation-metrics.json、denied-fix/metrics.json、fix-direct-3/card23-notification-metrics.json与detail-boundaries.json。最终检查和保留失败见执行记录。

## 发布前四项P2修补的补充验收

初次本地图与9fdcdfbd制品原件保留在原回执根及冻结tree对应binary patch；本目录当前图来自发布前修补候选，不重绑旧413项结果。

| 视口宽 | 对话栏宽 | 头部高 | 主题宽 | 身份/工具重叠 | 箭头在主题内 |
| --- | ---: | ---: | ---: | --- | --- |
| 901 | 285 | 101 | 209 | 否 | 是 |
| 950 | 334 | 101 | 258 | 否 | 是 |
| 1000 | 384 | 101 | 280 | 否 | 是 |
| 1100 | 484 | 60 | 152 | 否 | 是 |
| 1280 | 664 | 60 | 280 | 否 | 是 |
| 1360 | 464 | 60 | 132 | 否 | 是 |
| 1440 | 544 | 60 | 212 | 否 | 是 |
| 1441 | 489 | 60 | 157 | 否 | 是 |
| 1536 | 584 | 60 | 252 | 否 | 是 |
| 1920 | 736 | 60 | 280 | 否 | 是 |
| 900 | 860 | 60 | 252 | 否 | 是 |

V4：同一消息仅PENDING→失败，正文/ID列表不变，贴底差0→0；历史阅读材料锚点与offset保持，无新正文提示。V5：两个真实不同principal同显示名的回复均保留1个头像/1个meta；稳定人工作者ID缺失，人工合并仍为契约缺口。USER 300秒合并、301秒不合并。fixture交错投影：事务提交前目标Intake可见数0，提交后唯一Session。原RED为贴底差24、同名作者被合并、部分Intake可见数1并触发23505，原件均保留。

原始当前回执：review-repro-red.json、review-repro-green.json、fix-direct-3/delivery-layout.json及新增永久回归；工程师5分钟合并的旧通过不沿用为当前V5验收。

当前修补候选完整60入口422/422 PASS、定向5/5；独立Standards/Spec/Open Code Review复审均无剩余major/medium。其范围、固定tree、原始失败及后来CI身份分别记在执行记录和发布回执中。
