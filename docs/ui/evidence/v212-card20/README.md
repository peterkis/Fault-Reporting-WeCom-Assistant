# v2.1.2 卡20 · 本地截图与实测

本次仅执行卡20。Windows / Node24.18.0 / PostgreSQL18 / Chromium（Chrome156.0.8078.80），实际生产bundle、真实loopback HTTP与UUID隔离合成库；不是Electron原生、现场验收或部署。

原型参考为主目录用户原件“医小修 PC 管理端 v2.1.1 设计原型.html”，已定向读取01/02/03/04/05/08画板；原件未改写。来源哈希、完整尺寸及脚本回执在外部Evidence的prototype-source.json、after/measurements.json、screenshot-sources-final.json。

所有改前图保留原字节；对照仅并排拼接并加标题，无裁切、修图或重建。v211历史截图的日期、合成内容及计数可能不同，不能当同数据像素回归。当前main抽屉另在9184c5dd上补拍，避免卡18旧看板背景误导。

## 四宽前后对照

| 宽度 | 工作台：卡17历史→本卡 | 抽屉：卡18历史→本卡 | 抽屉：当前main补拍→本卡 |
| --- | --- | --- | --- |
| 1920 | [工作台](compare-board-1920.png) | [抽屉历史](compare-drawer-1920.png) | [抽屉当前main](compare-drawer-main-1920.png) |
| 1440 | [工作台](compare-board-1440.png) | [抽屉历史](compare-drawer-1440.png) | [抽屉当前main](compare-drawer-main-1440.png) |
| 1280 | [工作台](compare-board-1280.png) | [抽屉历史](compare-drawer-1280.png) | [抽屉当前main](compare-drawer-main-1280.png) |
| 900 | [工作台](compare-board-900.png) | [抽屉历史](compare-drawer-900.png) | [抽屉当前main](compare-drawer-main-900.png) |

## 改后原图与特定场景

| 场景 | 证据 |
| --- | --- |
| 工作台 / 负责3张 | [1920](board-1920.png)、[1440](board-1440.png)、[1280](board-1280.png)、[900](board-900.png) |
| 负责0张账号 | [1440](mine-zero-1440.png) |
| 待接单抽屉 | [1920](drawer-pending-1920.png)、[1440](drawer-pending-1440.png)、[1280](drawer-pending-1280.png)、[900](drawer-pending-900.png) |
| 已领取 | [1440](drawer-accepted-1440.png) |
| 处理中 | [1440](drawer-active-1440.png) |
| 等待厂商 | [1440](drawer-waiting-1440.png) |
| 已解决 | [1440](drawer-resolved-1440.png) |
| 两筛选 / 清除后保留日期与概况 | [生效](filters-active-1440.png)、[清除后](filters-cleared-1440.png) |
| 真实溢出的消息区、联系人列表 / 品牌蓝未读 | [1440](conversation-scrollbar-1440.png) |
| 看板真实横向滚动条 | [900](board-scrollbar-900.png) |
| 实际SSE连接、6px绿点 | [1440](realtime-live-1440.png) |
| 走查未复现的当前main底板/标题间距 | [main1920](main-before-board-1920.png) |

会话图仅验证T1/T6全局样式；沿原T22/Inbox helper补12张合成联系人及12条消息以形成真实滚动，使用简短合成姓名让未读数进入可见区域。长姓名造成时间/内容挤出的C1原图仍在外部Evidence，本次未修改会话页面、筛选、消息结构或右栏卡片。D5的右栏纯文字状态位置已交卡21 C10。

## getBoundingClientRect 实测

几何尺寸采用页面真实DOM的getBoundingClientRect；滚动条采用rect与client尺寸之差并减去边框。字号/颜色采用计算样式；伪元素圆点补核计算宽高。允许±1px。

| 项目 | 1920 | 1440 | 1280 | 900 | 目标 |
| --- | ---: | ---: | ---: | ---: | ---: |
| S1 标题→页签 | 12 | 12 | 12 | 12 | 12 |
| S2 页签→筛选 | 12 | 12 | 12 | 12 | 12 |
| S3 筛选→看板 | 16 | 16 | 16 | 16 | 16 |
| S6 元信息→标签 | 8 | 8 | 8 | 8 | 8 |
| S7 抽屉页签→内容 | 16 | 16 | 16 | 16 | 16 |
| S8 英雄区→下一步 | 16 | 16 | 16 | 16 | 16 |
| T5 阶段图标块宽/高 | 34 | 34 | 34 | 34 | 34 |

- 四宽均无页面横向溢出；900px仅看板内部横滚。三列底板透明，列高自然不齐。
- T5五状态图标块均34×34，正文均rgb(55,53,47)、14px/600；小标题12px/500次灰。
- T7八张抽屉均由标题实际持有焦点，outline-style和box-shadow为none；浏览器回归另断言Tab按钮仍有正常焦点环，以及键盘之后程序聚焦仍无框。
- T6看板水平条实际高度8px；会话列表与消息区实际宽度均8px，Chromium scrollbar-button为none；抽屉计算样式8px且无按钮。
- K2图标16×16，按钮原生aria-label/title均为“搜索选项”。G2开关与设置均32×32；G3手动刷新无点，实际live点6×6、绿rgb(68,131,97)。
- S9计数12px次灰，与保存按钮垂直中心差0；两者所有边界都在输入框内。保存按钮高28px，原Ctrl+Enter命令保持。
- T1品牌实心#2563C9、危险实心#C9332D，白字对比度5.665251/5.256670；会话实际未读背景rgb(37,99,201)，白字。

完整编号结论、文件清单、失败与未运行历史、最终检查及资源状态见[卡20执行记录](../../../../plans/pc-admin-design-v21/card-20.md)。
