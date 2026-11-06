# B5日期与结束方式组合证据

2026-11-06用户补充授权的前后端扩展，见[执行记录](../../../../../plans/pc-admin-design-v21/card-27b.md)和[搜索接口](../../../../api/workbench/search-source-forward.md#卡27b-b5日期组合2026-11-06)。本子目录不覆盖首轮九图和旧444项结果。

来源为正式PC构建、真实loopback HTTP和隔离PG18的浏览器入口；当前输入 `fdfc17a5e63a7b4e088cce2728de0258d5d49ac93b26276c97c3e7c4dce9ff63`，manifest `9ddfb37d546a17bf194faee8ce8977abe66a2a09f34671fd7bea988a43988448`。原始回执保存在 `D:/CodexEvidence/pc-admin-v217-card27b-b5-20261106/`，本目录[receipt.json](receipt.json)记录PNG尺寸、SHA-256和来源；[metrics.json](metrics.json)记录12组合的精确成员、布局和请求数。

| 已关闭筛选与日期 | 1440宽 | 1920宽 |
| --- | --- | --- |
| 今天 | [截图](list-today-dismissed-1440.png) | [截图](list-today-dismissed-1920.png) |
| 近7天 | [截图](list-week-dismissed-1440.png) | [截图](list-week-dismissed-1920.png) |
| 本月 | [截图](list-month-dismissed-1440.png) | [截图](list-month-dismissed-1920.png) |
| 手填自定义 | [截图](list-custom-dismissed-1440.png) | [截图](list-custom-dismissed-1920.png) |

八图均为Windows系统Chrome、DPR1、zoom1；视口高度1060，整页图实际高度以PNG回执为准。日期条与结束方式均在工具栏内、互不遮挡，无水平溢出；没有新CSS或Token。

四日期×三结束方式共12组，均验证真实响应的criteria、半开日期窗口和精确事项ID，再验证表格实际ID；第一、二列身份保持。未提交q草稿保留，提交后日期保持；reload确认新文档，切换看板/列表及结束搜索保留custom日期对，清除日期后请求不再携带日期字段。

本场景19次搜索，未改变20次/60秒及全App同时一次搜索的原限额；切换下一条件前等待前一真实响应完成。业务POST0，读取前后Ticket状态、版本、责任和事件数量不变。边界、闰日、未知关闭时间、GET/POST、游标串用及当前READ另由后端真实集成入口验证，不用截图代替。
