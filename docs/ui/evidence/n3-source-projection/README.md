# N3 关联来源 · 本地合成浏览器证据

[Issue #144](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/144)；同一生产bundle与真实loopback HTTP/PG，4条Ticket和2条Session异常，Sender为合成。此证据不代表现场或真实外发。

| 宽度 | 截图 | 来源列 / 表格 | 占比 | 行高 |
| --- | --- | --- | --- | --- |
| 1920 | [查看](notifications-1920.png) | 548.406 / 1376.000px | 39.855% | 56px |
| 1440 | [查看](notifications-1440.png) | 436.000 / 1136.000px | 38.380% | 56px |
| 1280 | [查看](notifications-1280.png) | 292.000 / 992.000px | 29.435% | 56px |
| 900 | [查看](notifications-900.png) | 240.000 / 940.000px | 25.532% | 56px |

工单真实编号为等宽链接，下方显示当前Ticket标题；Session显示“会话 · 欧阳慧敏（合成）”，不使用安全摘要猜字段。资料缺失的“会话 · 报修人（资料未提供）”由原真实队列浏览器用例另行断言。原编号/标题/姓名、parent_link、GET/POST/Sender次数和四宽几何均由已注册T32浏览器入口验证。

结构化原件与哈希映射：D:/CodexEvidence/pc-admin-n3-retirement-20261104/a-visual/。构建/测试身份及失败原件见[执行记录](../../../../plans/pc-admin-design-v21/n3-source-projection.md)。


## 64字合成姓名的真实溢出验收

补充长名用例在修复前真实失败：HeroUI链接的fit-content宽度使文字被单元格裁掉，未形成链接自身的省略号。保留[改前1920截图](long-name-before-fix-1920.png)。修复仅将Session来源链接限制为单元格内容宽度（width/max-width=100%），保留原链接和业务行为。

| 宽度 | 改后截图 | 文本scrollWidth | 链接clientWidth | 右边缘不越过单元格 |
| --- | --- | --- | --- | --- |
| 1920 | [查看](notifications-long-name-1920.png) | 869px | 524px | 是（两条均通过） |
| 1440 | [查看](notifications-long-name-1440.png) | 869px | 412px | 是（两条均通过） |
| 1280 | [查看](notifications-long-name-1280.png) | 869px | 268px | 是（两条均通过） |
| 900 | [查看](notifications-long-name-900.png) | 869px | 216px | 是（两条均通过） |

结构化原件：D:/CodexEvidence/pc-admin-n3-retirement-20261104/a-long-name-fixed-visual/notification-metrics.json；原失败日志、PNG/JSON和manifest在同一证据根下独立保留。此项不追认之前短姓名截图已经覆盖了真实溢出。
