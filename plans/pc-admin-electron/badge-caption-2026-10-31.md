# 工牌底边提示与扫光

状态：WEB_DEPLOYED / TECHNICAL_CHECKS_PASS / USER_ACCEPTANCE_NOT_RECORDED。用户要求“试试拖动工牌”移到扫码面板下方白色工牌底边的水平/垂直中心，并应用Uiverse neerajbaniwal/hungry-mule-59文字效果。初始HEAD `982154500e1465bc15e10d0102f4e4ab8e875698`，工作树干净，唯一写者为当前会话。沿本会话登录UI的提交/推送/服务更新授权交付。

## 实现与边界

原官方320×380面板和WebGL开窗完全保留；文字使用独立、透明、仅一个对象的CSS3D投影层位于WebGL之上，同一相机/工牌世界姿态，位置由面板底边与卡底边中点计算。没有新WebGL renderer/纹理逐帧上传，不移动活iframe。交互命中层仍在最上且文字pointer-events:none；正面与扫码面板同一朝向判断，背面隐藏，卸载恢复父级拥有的文字节点并释放展示层。

扫光沿参考3秒线性循环，0→60%背景横移0→180px，60→100%停留；保留现有中文字体，深灰底字适配浅色工牌，白色高光，水平内边距适配短文案。纯CSS小范围绘制，隐藏/离线暂停，Unsupported background-clip保留静态文字。页面仍默认完整动效，不增加系统减动设计或新画质/动效选项。原外部提示占位转为28px排版留白，保持主体构图。

背景550000预算、独立30fps、配色/范围/节奏不改；认证/期限/视图切换、退出及版本桥、主进程/客户端、数据库/迁移、配置/Flag和依赖不变，无真实业务写入/发送，不推进Gate。源码和分发页面保留MIT版权/许可，见app/pc-admin/THIRD_PARTY_NOTICES.md；CSS构建会移除注释，因此页面用非可见注释携带许可。0.1.14刷新生效，无需重装；服务回退沿旧550k owner及备份/脚本。

## 验证

实现提交`54e1eaf75e6735b1e6e459f13d0f137be4bc04fc`，最终源码/被测/部署提交`8a228291fffa1b5a9dd66843ffb49606bdf5b804`（tree `bdbeee0f0328cb3bf05dbe18a901d547fb1a0b25`；第二提交补充分发页面的非可见MIT许可）。最终候选构建911项语法检查、2739项输出通过，strict/negative通过，正式登录浏览器1 PASS / 0 FAIL / 0 SKIP，19项文档工具及制品/文档检查通过。浏览器保留原拖动/翻面/同iframe/压缩/550k/30fps断言，增加底边中心、原面板尺寸、3秒扫光轨迹/停留/不拦截及背面隐藏。前置Web类型检查曾发现闭包内可空frontHint，已在启动入口补充守卫后通过；原失败和第一候选日志均保留，最终`*-02.log`重新构建和验证，没有用旧head结果代替。

实际0.1.14合成Provider在1440×960和1000×720视口视觉检查通过；提示位于扫码面板下方约224×29.5px白色底边内，字形中心相对区域中心水平误差小于0.001px、垂直误差约0.35px。截图`visual-1440.png`、`visual-1000.png`及固定动画相位`shine-base.png`/`shine-sweep.png`保留。真实从提示文字处拖动、翻面隐藏通过，同一iframe未重建。图形测试分开运行。

扫光活动时6秒观测：背景29.96fps，独立缓冲908×605=549340像素；页面rAF59.92fps，GPU pass均值1.95ms，静止工牌WebGL draw/clear均为0。2.4秒拖动期间背景29.98fps、页面59.95fps，144次WebGL clear约60fps，同iframe/原始rAF保留，无探针错误。最小化/模拟renderer离线期间背景提交均为0，恢复后61次提交；两个自有验证窗口正常退出code0。这些是本机短时观测，不是整机功耗、真实断网合盖或手机验收。

## 服务交付

已通过HTTPS推送源码，并部署`pc-badge-caption-20261031-01`至`https://cd3120.mobimedical.cn`，运行owner `human-workbench-20261031-pc-badge-caption-01`。prepare 48 PASS / 0 FAIL / 0 SKIP，activate/postflight及32项readiness通过；公开6项逻辑资产/18项br、gzip、identity表示的字节与解码SHA、HEAD/Vary/拒绝旁路检查通过；登录页许可、安全头和未认证工作台跳转检查通过。与旧运行时比较：H5输出差异0；服务源码输出仅`workbench-embedded-login.mjs`（页面提示位置与许可）变化。

正式候选input `5ee650965599f7e21c031e241150bc84163a792603843b41b27efde6544039c3`、manifest `6a69238de7090c985fb9dc1d7015791301a4bf89b2060305170fd1bb05e4482d`。部署兼容派生input `94ded0dde367326d7865a3f83fbbc86af9aeab06cd96647fa6902e5f87d2688e`、manifest `4977ab9e13c353e154205ffe1c80b11de32b16d327ad63ae38ba8662ed981d33`；仅保留线上032/035/037/067/068/069六项SQL原始换行字节，规范化后等价，所有程序/web输出与最终被测候选相同，源码/普通制品及其验证proof已恢复。没有应用迁移。

无证书绕过、无Provider替身的实际域名0.1.14窗口确认：scene ready、shader、提示处于工牌正面投影层、动画3s且pointer-events:none、单一活iframe；背景29.60fps、页面59.58fps，缓冲仍为549340像素，原始rAF未替换。无需客户端重装，登录页刷新生效。

42项配置、30项迁移记录、10项媒体（含5项原件）保留；无业务POST、测试发送、Flag或依赖变更。远端7项自有临时上传已精确清理，旧550k owner、数据库备份及回退脚本保留。本地两个自有验证窗口正常退出后，核绝对路径、无重解析点/活进程及普通制品已恢复，清理4项临时stage/profile和1项regular-runtime副本；保留原始日志/截图、manifest及唯一冻结发布包，见`owned-cleanup.json`。未运行full/certify、真实手机/物理合盖验收，不代填用户接受或推进Gate。证据目录`.local/electron/badge-caption-20261031/`，汇总`deploy/delivery.json`。
