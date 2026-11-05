# PC 管理端 v2.1.5 卡24 · Windows证据

[执行记录](../../../../plans/pc-admin-design-v21/card-24.md)。基线/HEAD `f71a1cb8e51a2731ca72be78429a281b4fcbbebf`，分支codex/pc-admin-v215-card24的未提交差异。Node 24.18.0、PG18.4、Windows Chrome 156.0.8078.80，真实loopback HTTP、UUID合成库；截图devicePixelRatio=1、visualViewport.scale=1。原始JSON/TAP/失败和hash清单集中在 `D:/CodexEvidence/pc-admin-v215-card24-20261105/`，没有改写历史证据。

最终应用构建输入 SHA-256 `167b10c3c7d74bb9f5cb5541ce6956a6beaf24e5f4d79751b92ff753471c3e4b`；manifest SHA-256 `389e95a0ed090ada7c5b97e4aff346101c6467651cf25a474a7bb65d9dec96da`。本目录截图来自同一制品direct-10，后续只有交付文档变化。全量适用回归完成情况在执行记录单列，不以截图代替测试。

## 前后对照（Windows，缩放1）

改前沿卡23/卡22原件链接，数据、时间与滚动位置可能不同；这是呈现对照，不声称整图像素差分为零。没有重建或覆盖改前截图。

| 页面 / 宽度 | 改前原件 | 卡24 |
| --- | --- | --- |
| 工作台1440 | [卡22](../v213-card22/board-1440.png) | [改后](board-1440.png) |
| 抽屉1440 | [卡22](../v213-card22/drawer-1440.png) | [改后](drawer-1440.png) |
| 可回复会话1440 | [卡23](../v214-card23/conversation-allowed-1440.png) | [改后](conversation-allowed-1440.png) |
| 待接待会话1440 | [卡23](../v214-card23/conversation-waiting-1440.png) | [改后](conversation-waiting-1440.png) |
| 无回复权限1440 | [卡23](../v214-card23/conversation-denied-1440.png) | [改后](conversation-denied-1440.png) |
| 含发送失败会话1440 | [卡23](../v214-card23/conversation-failed-1440.png) | [改后](conversation-failed-1440.png) |
| 通知异常1440 | [卡23](../v214-card23/notifications-1440.png) | [改后](notifications-1440.png) |
| 工作台1920 | [卡22](../v213-card22/board-1920.png) | [改后](board-1920.png) |
| 会话1920 | [卡23](../v214-card23/conversation-allowed-1920.png) | [改后](conversation-allowed-1920.png) |

## 两倍字形局部

浏览器原生clip、scale=2，非图片放大替代。

| 部位 | 两倍原件 |
| --- | --- |
| 工作台卡片编号与标题 | [字形](glyph-card-x2.png) |
| 会话气泡与meta | [字形](glyph-bubble-meta-x2.png) |
| 通知时间列 | [字形](glyph-notification-time-x2.png) |
| 侧栏账号区 | [字形](glyph-account-x2.png) |
| 输入区计数、草稿、清理按钮与kbd | [局部](detail-composer-bottom-x2.png) |
| 已映射与未映射错误展示 | [局部](detail-errors-x2.png) |

## F1–F4 字体

[完整99文件与大小/哈希](font-files.md)，[三页首屏下载逐文件清单](font-downloads.md)。三套字体使用实际package family；sans的计算栈以Inter Variable开头，编号以JetBrains Mono Variable开头。document.fonts.check全部为true、三个族各至少一个实际使用face为loaded，错误face为0。没有强制加载未使用的中文分片。

| 页面 | 首屏实际字体文件 | 字节（不含HTTP头） | 已加载中文分片 | 外域字体 |
| --- | ---: | ---: | ---: | ---: |
| 工作台 | 14 | 790,516 | 12 | 0 |
| 会话 | 16 | 861,292 | 14 | 0 |
| 通知异常 | 13 | 732,248 | 11 | 0 |

每入口外置字体99文件、4,537,324字节；两个Web入口共198份、9,074,648字节，去重99份。无data URI；现有font-src 'self'不变，未开放远程源。构建与HTTP断言覆盖99分片、WOFF2 magic/MIME、工作台认证、登录HEAD/编码协商及未登记字体/查询/sidecar拒绝。

离线证据分开解释：[已加载的正式页面断网](offline-loaded-fonts-1440.png)在浏览器Network offline后字体仍loaded；[Windows Electron冷启动、服务不可达](offline-cold-electron.png)实际显示“暂时无法连接”。Electron 45.0.0安装壳未包含Web bundle/字体，不能离线冷启动业务页；本卡未改变宿主架构、缓存或连接行为。前一张不冒充离线冷启动成功。

## 数值验收

以下为getComputedStyle/getBoundingClientRect实测，自动断言使用精确值；三页字体数据见上表。

| 编号 | 实测 | 结论 |
| --- | --- | --- |
| C1 incoming first 四角 | 4 / 12 / 12 / 12px | PASS |
| C1 incoming rest 四角 | 12 / 12 / 12 / 12px | PASS |
| C1 outgoing first 四角 | 12 / 4 / 12 / 12px | PASS |
| C1 padding 上右下左 | 10 / 12 / 10 / 12px | PASS |
| C2 消息头像 / 合并占位 | 28×28 / 28px | PASS |
| C3 横幅bottom到输入top | 0px | PASS |
| C3 横幅高度 | 49px ≤52px；单行省略、按钮不收缩 | PASS |
| C3 待接待背景 / 计数 | rgb(255,255,255) / 0 / 2000可见 | PASS |
| C3 无权限背景 | rgb(247,247,245) | PASS |
| C4 清理草稿 | 12px字号、24px高、0px边框；左状态区 | PASS |
| C4 空输入可回复快捷键 | 可见；待接待/无权限隐藏 | PASS |
| C5 placeholder | 无“给 ”、无“ …” | PASS |
| C6 已映射码 | 结果待核实 · 企微接口超时；title保留COMMUNICATION_SEND_TIMEOUT | PASS |
| C6 未映射码 | 发送失败 · 错误码 V23_SYNTHETIC_FAILURE；mono/12px，title保留码 | PASS |
| C7 联系人异常标记 | 1个12px SVG、文本空、aria/title保留 | PASS |
| C8 头部 | 底线1px；timeline.top−header.bottom=0px；滚动区overflow=auto | PASS |
| C8 状态标签 | 待接待/warning；接待中 · 我/brand；接待中 · 只读值班/brand；已结束/neutral | PASS |
| C9 区块标题 | 13px / 600 | PASS |
| C9 姓名 / 科室 | 14px / 600；12px | PASS |
| C9 来源三行 | 13px / 22px；标签secondary、值primary | PASS |
| N1 表头 | th底边0px、shadow none；tr底线1px，宽1136=表格1136px | PASS |
| N2 结果标签 | 每个1个12×12px SVG，图标文字间距4px | PASS |
| N3 来源后缀 | 会话 · 报修人；其它合成后缀由既有N3回归保留 | PASS |
| G1 标题底块 | 36×36px；icon20px；标题left320/top66、图块left272/top64 | PASS（四页同值） |
| G1 通知副标题 | left320px = h1.left320px | PASS |
| G2 品牌行 | 48px高、28px标识、15/600名称；团队与面包屑同源同值 | PASS |
| G3 三处kbd | 18px高/最小宽；左右4px；1px边框；4px圆角；12px/500/sans | PASS |

同宽所有页面无横向溢出。工具栏仍横跨整页，内部锁与“内部”仍在气泡内；未增加等待最久排序、等待时长或全局等待人数推算。


F4打包检查口径：本轮执行原生Build（stage）和实际Electron进程验证，未生成新的NSIS安装包。现有打包白名单与本轮stage均不含Web bundle/WOFF2，因此字体由服务器随Web产物分发；不将源白名单检查冒充新安装包验收。


## 最终补充值

- F2：Modal、Tooltip与候选上下文精确等于完整sans栈；Chrome实际字形接口返回自定义Noto字体，确认中文没有回落到微软雅黑。
- F3：[列表编号实拍](font-list-1440.png)：编号列JetBrains Mono，表头Inter/Noto；[未知错误码两倍](glyph-error-unmapped-x2.png)：JetBrains Mono/12px。
- C8：[滚动到中段](conversation-scrolled-1440.png)：scrollTop300，header.bottom与timeline.top同为212px，没有头部下方内容穿出。
- C3：横幅四角10/10/0/0，输入四角0/0/12/12，边界分别1/0与1px；补句字重400。
- G1：工作台、会话、通知异常、公共故障候选四页均title x320/y66，底块36×36/8圆角、svg20。
- G2：名称15/600、团队12/400、品牌行水平padding8/下间距8，标识left16=导航图标left16。

额外测量来自同一最终运行制品与既有UUID合成夹具，未通过伪造API、capabilities或DOM样式注入获得。


最终检查完成：当前样式候选15个PC/读取安全入口112项、Windows Electron1项、卡24直接4项及补充实测全部通过；较宽MVP集合在前一候选61入口429项+原生1项通过，工具7文件128项通过。最后差异仅两份CSS字体声明，2603个非Web产物完全相同。所有结果保留各自验证对象，不累计重叠计数或把前一候选改写为本次全量认证。最终artifact已校验、PG/HTTP/浏览器已关闭，分支/worktree保留；没有提交/推送/PR。
