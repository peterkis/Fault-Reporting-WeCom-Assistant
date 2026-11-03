# 卡 18 Astra 独立复核

审查对象：`origin/main@c2ab09b518fe97e5b9b6b910455b66a5b746a02d` 上的未提交工作区，`D:/worktrees/pc-admin-v211-card18`。18/18 个源码/测试文件在本次读取时与 `verification.json` 所记哈希一致。源码唯一写者为 root；本复核没有修改源码、提交、推送、PR、后台进程或数据库。

结论：发现 1 项应修的展示语义缺陷、2 组明确的视觉偏差。未发现 P1 级业务命令/权限/状态回归。视觉不能标为像素一致：本轮原型浏览器渲染受工具/URL政策阻断，以下原型依据为用户文件静态解包的真实 DOM/CSS，当前实现像素依据为用户指定的四宽及两张错误态截图。108/108 PASS 是所提供证据；本复核没有重新运行这 108 项。

## 应修项

### A1 · P2 · EXTERNAL 可见性被写成发送成功

- 文件：`app/pc-admin/src/app/DetailPresentation.tsx:50`。
- 当前差异：将外部备注标签从“报修人可见”改成“已发给报修人”。
- 事实源：`app/server/src/web01-workbench-query.mts:328–331` 直接把 `ticket_event.external_note` 投影为 `type='对外摘要', audience='EXTERNAL'`，状态字段均为 null；没有查询 Delivery、ACK 或 SENT。`docs/api/workbench/tickets.md:222` 明确工作人员完工通知承诺不等于 Delivery。
- 复现场景：登记完工已有对外摘要，而通知尚未产生、未发出、UNKNOWN 或 FAILED；该记录仍会被 `recordKind` 归为 note，出现“已发给报修人”。这会误导处理人员以为报修人已获通知。
- 最小修补：恢复“报修人可见”，或使用事实名“对外摘要”；保留颜色与分类，不新增网络请求、不推导投递成功。

### A2 · P2（视觉）· note/report 正文没有形成原型的第二行气泡

- 原型：`prototype-review/drawer-leaf.html:2829–2834`，报修与内部备注都由一行姓名/说明/时间和下一行正文 `<p>` 组成；内部标记在头行。正文 `margin:6px 0 0; padding:10px 12px; border-radius:4px 12px 12px 12px; font-size:14px; line-height:22px`。内部底色 `#FBF3DB`、外部/报修底色 `#F1F1EF`，正文继承主文字 `#37352F`。
- 当前实现：`Timeline/timeline.css:15–18` 把姓名、正文、标记放在同一 baseline flex 行，正文 `flex:1`，只有点击展开才可能占满下一行。`Drawer/drawer-v21.css:50–51` 用 12px 内边距、8px 统一圆角、8px 上间距，并继承 13px/20px；只有内部正文显式变成 text-primary。
- 像素证据：after-1440 中内部备注气泡 `(796,614)–(1288,658)`，姓名与正文在同一基线；报修灰气泡 `(809,503)–(1332,547)`。灰气泡正文有 464 个完整像素为 `(107,105,101)=#6B6965`；内部正文为 `(55,53,47)=#37352F`。四宽抽屉均为 720px，这个偏差在四宽均出现。
- 最小修补：只对 note/report 的 `.ds-button-label` 调整为头行+正文第二行，保留 HButton、PersonalReadMaterial、展开行为及原钩子。正文用 `--fs-md/--lh-md`、`calc(var(--space-2) + var(--space-0-5)) var(--space-3)`、`--radius-xs --radius-lg --radius-lg --radius-lg`、`--text-primary`，内部继续 warning 背景。不要把 status/event 重新包成气泡；不要删除长文本展开功能。

### A3 · P3（视觉）· 报修区域残留两条额外横线，页签间距缩小

- 原型：`drawer-leaf.html:2823–2829` 在页签底部有一条 `1px rgba(55,53,47,.09)`，随后为日期和第一条报修记录，没有报修块的上下边框；页签 gap 为 20px。
- 当前：`Drawer/detail-content.css:40` 的 `.detail-description` 上下边框继续生效，`drawer-v21.css:46` 只覆盖 margin；1440图 x736–1408 的 y456 与 y559 各出现一条 `(237,237,236)` 发丝线，加上 y431 页签底线，共三条。`drawer-v21.css:41` 页签 gap 为 `--space-4=16px`。
- 最小修补：在本卡可写的 drawer-v21.css 内对描述容器取消两条 border，不移动报修事实/分组，不删原选择器；页签 gap 改 `--space-5=20px`。日期格式按用户本次短日期规则保留，不能恢复原型仅 HH:mm 的旧式时间。

## 必须区分的参考差异

1. 原型是 WAITING_VENDOR 的 PACS 工单，交付稳定图是当前人 IN_PROGRESS 的打印工单。标题、类别、来源、人员、属性条数、主按钮文字、热度和记录条数不能逐像素相减判错。标题蓝色焦点框是稳定图真实键盘焦点态，不应为了匹配静态原型移除。
2. 等待态下一步仍存在可确定的 CSS 差异：原型 `drawer-leaf.html:2810–2813` 为 `#FDF6EC` + `inset 0 0 0 1px #F2D9B8`，主文 text-primary、辅文 text-secondary；实现 NextStep.tsx:30 只有 data-stage，drawer-v21.css:17–19 对全部 active 使用 `#E8F0FC` + `#1D4FA3` 且无边框。因此即使切换到同一等待状态也不会呈现原型暖色。旧 v2.1 文档又写底色跟随阶段，现有 token 无原型这两个精确新色。应由 root 依用户最新范围取舍：使用现有 attention/ring token 做展示语义修补并记近似，或明确列为原型/Token冲突。不能加裸色或宣称精确匹配；主按钮与 action 排序不变。
3. 底部输入区原型 `drawer-leaf.html:2838–2842` 为 `#FFFDF6` 近白底、黄色内部徽标；当前 `drawer-v21.css:57–58` 为整个输入框 `#FBF3DB`，标签无独立黄色底。这是既有视觉偏差、并非本卡新增，且现有 token 没有 `#FFFDF6`；不能为了像素一致绕过不新增Token的范围。
4. 轨道原型 22px头像、10px gap、线 rgba(.12)，实现使用既有 avatar-sm=20px、gap8px、border-hair=.09。这些 Token 约束下的细差应明确记录，不能误报为像素一致。
5. 原型字体 Inter/Noto Sans SC，仓库字体优先 PingFang/Microsoft YaHei UI。原型画布1440×1060，交付图1440×1080。没有同字体、同状态、同视口的本次渲染，禁止给出整体像素相似度百分比。

## 已核对的正确项

- `ticket.note_added` 带当前 new_status 仍归 note；前后状态相同的其它事件归 event；status/event 无气泡，阶段圆点正确使用 intake/active/done Token。
- 本人文案使用 caller-only HANDLING；实际查询 `web01-workbench-query.mts:96–97` 按当前 principal 与 assignee_id 匹配，不按姓名比较。
- 接管文案提示受 allowed_actions 限制；原 NextStep orders、主按钮命令、未知回执与UUID控制器不变。
- 北京短日期/跨年处理及完整title保留秒；三个附加授权组件只替换只读时间展示，时间输入与提交值不变。
- 页签选中600、2px text-primary下划线、零计数隐藏；四宽实际截图选中页签唯一。callback ref局部补aria-selected，没有改共用Button。
- 两张错误图 danger背景确为 `#FDEBEC`，文字像素为 `#B4332B`，不是浏览图片观感中的纯红；重试为ghost。接管图上方其它控制器仍有旧错误文案，这是边界外既有呈现，不应据此扩大本卡。

## 限制和审核步骤

1. 读取卡18任务记录、验证索引及18文件差异：完成，哈希匹配18/18。
2. 查看四宽稳定图和两张错误态图：完成；抽屉720px，右/顶8px在提供测量中成立，未见本卡抽屉横向溢出。
3. 原型抽屉真实浏览器渲染：未完成。browser-use 初始化返回 “privileged native pipe bridge is not available; browser-client is not trusted”；cua chrome 的 file URL 导航被URL安全策略拒绝，仅允许http/https，且明确禁止间接或替代表面绕过。同一被拒动作未重试，没有HTTP代理、CDP或其他绕过。
4. 原型静态解包DOM/CSS与截图取色：完成；见本目录 observations.json。原型外层与drawer-original的 `__bundler_thumbnail` 仅找到CSS选择器，未找到实际同ID的保存SVG，不把其当渲染证据。
5. 修补后审查：等待 root 修补；本报告只绑定以上未提交候选快照，不把后继改动算作已审。
