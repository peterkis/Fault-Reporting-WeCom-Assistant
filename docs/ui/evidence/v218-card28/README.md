# 卡28 Windows 截图与实测

基线 `728d9d9fa95edf7e911b8bd51891df5e802296a7`，独立worktree的审查修复候选review-02。Windows系统Chrome、DPR1、visualViewport.scale=1；主图高度1060px。2倍局部使用原DPR1的Page截图clip.scale=2，坐标含页面scrollX/Y；PNG宽高、哈希均已核对。原图不是CSS缩放或图像重采样。

[机器实测](metrics.json) · [截图尺寸/环境/SHA-256回执](receipt.json) · [本卡执行记录](../../../../plans/pc-admin-design-v21/card-28.md)。

## 宽屏状态与窄屏

| 状态 | 1440px | 1920px |
| --- | --- | --- |
| 全部阶段 | [全部](list-1440-all.png) | [全部](list-1920-all.png) |
| 结束方式=已关闭 | [已关闭](list-1440-dismissed.png) | [已关闭](list-1920-dismissed.png) |
| 已提交搜索 | [搜索中](list-1440-search.png) | [搜索中](list-1920-search.png) |

[900px横向滚动](list-900-scroll.png)：scrollLeft=180时第一列仍在left=16px；分组标签保持可见，阶段标签left=28px。

## 2倍局部

| 内容 | 原图 |
| --- | --- |
| 阶段分组行 | [分组](group-x2.png) |
| 子分组行 | [子分组](subgroup-x2.png) |
| 待受理行、热度与催2次 | [待受理](pending-heat-urge-x2.png) |
| 选中行与左侧内描边 | [选中](selected-x2.png) |
| 人工关闭 | [人工](closed-manual-x2.png) |
| 系统判定关闭 | [系统](closed-system-x2.png) |
| 重复关闭、合成原单编号 | [重复](closed-duplicate-x2.png) |
| 原获权领取按钮与E | [悬停领取](hover-claim-x2.png) |

## 主要实测

| 项目 | 实测 |
| --- | --- |
| 1440下七列宽 | 192 / 292（自适应） / 108 / 124 / 188 / 124 / 92px |
| 表头 / 数据行 | 36 / 44px |
| 阶段行 / 子分组行 | 54 / 32px |
| 阶段标签 | 26px，与看板同色同底色 |
| 阶段折叠按钮 / 箭头 | 24×24 / 14px |
| 剩余项按钮 | 12px，左padding=4px |
| 搜索前 / 后第二行工具栏 | 32 / 32px，差0px |
| 处理人与结束方式chip间距 | 8px |
| 搜索清除图标 | 16px，24px按钮完全位于32px输入框内 |
| 选中行 | 左侧2px品牌内描边，border=0 |
| 已关闭瓷砖 | grayscale(1)、opacity=.55，无热度 |
| R2同卡元信息行恢复对照 | 122→96px，减少26px；正式卡片不含该行 |

结束方式可见集合严格断言：全部=待受理/处理中/已处理（四子组），已完成=仅已处理/已完成，已关闭=仅已处理/已关闭。折叠偏好往返、当前获权领取/不可领取行、Enter详情、空阶段及零业务写入均由注册Card12浏览器入口中的Card28场景验证。另以同候选原生Tab补测并核Chrome AX树：命名table、7个列头、3个命名分组和编号行头齐全；原件在D:/CodexEvidence/pc-admin-card28/keyboard-ax.json。

## 来源与限制

这是本地合成图。API仍为真实loopback HTTP/PG；仅Card28显式启用的fixture沿原response.end测试缝加入原单display_no、催单、待复核和缺失资料。真实后端duplicate_of仍为null，不能把合成原单视为27C关联写入已实现。搜索中缺少的分类/阶段起点沿响应保持未分类/无有效时长，不从其它时间推算。

最终图另覆盖无Ticket的已完成受理（success）与受理失败（danger），状态值来自本地合成数据库的既有字段。

早期布局、裁图偏移和失败原件保留于 `D:/CodexEvidence/pc-admin-card28/attempt-01/` 至 `attempt-03/`。当前目录15图均来自审查修复候选review-02的新Card28 PASS；不以旧图补本候选验收。Electron、现场、CI、full/certify、部署及真实发送未运行。


## 审查修复复验

初审原件已保留在外部发布根的review-initial-source.zip与review-diagnostic-01-evidence。当前15图及metrics/receipt来自注册Card12入口的93项复验中Card28场景，增加真实SSE连接和导航冻结、父阶段先折叠再筛选、1280实际窄容器横滚、编号格真实hover/click、8汉字完整两行姓名。1280与900的容器宽/滚距及冻结列坐标均在metrics.containerWidths，截图仍按原任务15图交付。

新源码层级：首列10、原row-link透明命中11、原领取slot/kbd12、表头40；新姓名样本完整显示8字、font13px/头像20px/姓名框40px/行44px。业务POST仍为0。后续仅将两份T41测试的D盘物理宿主断言限定Windows并在所有平台检查临时根绝对路径；应用输出逐字节等价证明单独保存，不更改这些图的原候选身份。
