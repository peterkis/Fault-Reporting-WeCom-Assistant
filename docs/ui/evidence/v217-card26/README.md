# 卡26：Windows 浏览器视觉证据

分支 `codex/pc-admin-v217-card26`，基线 `702f80d653f0c96f6febd7404c58834246427fe7`；本地未提交候选。交付结论与失败记录见[执行记录](../../../../plans/pc-admin-design-v21/card-26.md)。

截图由仓库既有Windows系统浏览器宿主加载正式构建，通过真实loopback HTTP与隔离PG读取合成数据；同批收件箱测试另有真实SSE回归。主三档视口的 `visualViewport.scale=1`、`devicePixelRatio=1`；两张气泡局部以DPR2、`visualViewport.scale=1`、`clip.scale=1`原生采集，按实际背景的document包围区域加4px外距，不修改产品样式或对像素做后处理。具体候选与尺寸以回执为准。

| 文件 | 验证内容 |
| --- | --- |
| [conversation-1440.png](conversation-1440.png) | 补句先隐藏、姓名省略、核心状态完整；240px主题选择器、渠道、抽屉链接对齐 |
| [conversation-900.png](conversation-900.png) | 单聊天布局；核心状态完整，不以视口宽度强制隐藏可容纳的补句 |
| [conversation-1920.png](conversation-1920.png) | 姓名、核心状态、补句全部可见 |
| [bubble-incoming-x2.png](bubble-incoming-x2.png) | incoming组首4px左上角与后条四角12px |
| [bubble-outgoing-x2.png](bubble-outgoing-x2.png) | outgoing组首4px右上角，其余12px |
| [board-1440.png](board-1440.png) | 至少四种分类颜色、未分类卡；泳道5%内描边 |

[metrics.json](metrics.json)保存原始计算样式与几何实测；[receipt.json](receipt.json)保存尺寸、SHA-256、构建输入和manifest身份。数据全部为合成材料；UI截图与接口自动化只证明本地范围，不代表Electron、现场业务、真实发送或部署验收。

2026-11-06独立审查发现初版incoming图右角没有完整入镜。原21文件已按初审输入冻结在 `D:/CodexEvidence/pc-admin-v217-card26-review-20261106/snapshot/`，原SHA与失败像素观测保持；本目录用于修复后最新回执，不将旧图伪称为完整圆角证据。新增`headerSamples`覆盖1360/1366/1440下的缺资料回退名，`samples`增加中间宽度状态/动作二维遮挡和边界检查；原三档要求截图保留。

用户原型原件保持在主目录 `D:/Projects/Fault-Reporting-WeCom-Assistant/docs/ui/prototype/医小修 PC 管理端 v2.2 设计原型.html`，4,787,324字节，SHA-256 `fd6c25ff3fd66dc2ac333b05ef6dd1c439b798d85184770065d01f1532c1df37`；不纳入本卡改动。
