# H5 Animate UI 验证分支

## 输入、输出与停止线

用户于 2026-10-22 明确授权实施动效验证计划。输入为 main `d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f`；分支为 `codex/h5-animate-ui-evaluation`，追踪 [Issue #120](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/120)。交付 A 当前界面、B 新交互静态界面、C 新交互官方动效的可复现对照，以及源码、实际测试、包体和资源证据。用户随后明确要求部署云端服务器、由本人在真实企业微信逐组查看；因此允许准备与发布独立验证版本，按 A → B → C 顺序、每组反馈后再推进。验证分支仍不自动合并 main。代理不真实发送、不写现场业务数据库、不推进 Gate；Issue #117 的既有真机待验状态不变。

现有 [ADR-0036](../../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)、[ADR-0040](../../adr/0040_h5_single_voice_capture_and_optional_transcription.md)、[ADR-0041](../../adr/0041_h5_react_router_shared_shell_and_interaction_readiness.md)、[ADR-0042](../../adr/0042_h5_continuous_navigation_and_silent_entry.md) 的授权、媒体、路由、连续展示及命令语义保持。本实验不建立新的业务状态或后端 API，不包含数据库变更。

## 对照入口与展示合同

文档级显式查询参数 `ui=baseline|static|animated` 选择 A/B/C；普通构建中缺失或非法值均为 baseline。只在本验证分支提供，不持久化用户选择、不更改任何持久 Feature Flag，也不能绕过企业微信身份或现有 DEV 合成预览边界。切换模式使用新文档；有草稿或 UNKNOWN 时不自动刷新。

云端逐组验证允许具名构建参数 `H5_UI_EVALUATION_PROFILE=baseline|static|animated`，缺省仍为 baseline，非法构建值拒绝构建。每个发布回执必须记录该公开参数、制品哈希和逐组反馈。这样 OAuth 返回规范入口后仍展示当前获准验证组，无需修改认证返回路径或保存浏览器选择。显式 URL `ui` 仅覆盖当前文档；正常构建与现有主线默认保持 A。

- Workspace Report 保留原 Link。C 先显示静态可用按钮，官方 Shine 加载后约 2 秒首次扫光，每次约 1 秒，间隔 8 秒，每次访问最多 3 次。hover、焦点、按下、不可见、禁用或导航期间暂停；文本和卡片不移动。
- 时间线保留现有排序。当前节点为公开进展（若存在），否则为最新事件。未完结且当前读取核验成功时仅该图标外圈以约 2.8 秒周期呼吸；完成、取消、不受理、复核、失败、隐藏或离开视口时静态。重开后按最新确认状态恢复。
- FAULT 提交在原校验及原命令进入 pending 后播放一次 300–350ms 的官方 Send 纸飞机反馈；固定图标槽，原请求同时执行。成功立即导航，可截断动画；拒绝、冲突、UNKNOWN 停止动效，不自动重放或伪装成功。CONTACT_REQUEST 不使用纸飞机。
- B/C 将补充、评价、未解决反馈改为底部 Sheet；图片在应用内查看，保留显式原图读取；C 增强真实上传 Progress、评分 Radio Group 和弹层 Button。A 保留原布局与操作路径。Sheet 约 220ms 进入、140ms 退出，无拖拽关闭表单。
- 不加入整页过场、列表入场、数字滚动、打字机或动态背景。顶部加载条、SWR、录音用户手势、原生 ACK 与回听路径保持。

## 隔离、懒加载和降级

采用 `@animate-ui/react@2.0.0`、`motion@14.6.0` 和必要 Radix 依赖，固定版本及根唯一 lockfile，不执行全量 `animate all`。动态模块按场景加载并共享 Motion。首页和时间线只在内容就绪、可见和空闲后加载装饰，繁忙时取消；其余按用户意图加载。初始界面与业务操作不等待动效。

静态/动态展示共享现有数据、草稿与命令状态。动效到达时不替换已聚焦/输入/按下的控件；弹层本次打开固定实现，不能因模块加载而重挂载表单。权威内容撤销立即清理，不等退出动画。图片沿既有授权 fetch、资源上限、Object URL 回收与代际栅栏，不直接绕过读取 Port。

减少动态效果、能力不足或动效 chunk 失败时静态可用，保留文字反馈。循环隐藏/离屏/卸载停止，资源清理可核验。外部浏览器仍只显示企业微信指引。Android 企业微信是目标实机；iPad mini 2 仅探索，不触发旧内核适配；现代 iPhone 未实际运行前记为 NOT_RUN。

## 验证与退出

保留 120KiB 完整必需首屏 JS gzip、2KiB 主题脚本及原性能门槛；自动后加载/交互后加载字节和解析成本单列。沿原 2CPU/4GiB 资源工具运行实际浏览器，复用现有注册测试/Profiler，源码与正式制品身份分别记录。共享 Motion 依赖变化同时核对工作台原型构建，不以 H5 通过代替。

重点验证三次扫光上限和停止条件、唯一当前节点/终态/同秒排序/复核、纸飞机各命令分支与单次请求，另覆盖 Sheet 焦点和草稿、图片权限、上传进度、评分、动效加载失败、reduced-motion、中英文/明暗/320及390px。A/B/C 分别记录实际收益与代价，保留失败原件。交付可复现预览入口、对照影像、逐项保留/调整/移除建议与真机清单；未实际运行的 Android、iPad、iPhone 不计为通过。

撤销方式为使用 baseline 或切回既有 main/冻结制品。用户原件、本地配置、未提交差异和历史证据保留。

## 实现说明与参考

- 入口的 Link 和按压 DOM 始终保持；官方 Shine 作为背景装饰挂入，文字不缩放。官方 Button 用于已固定实现的弹层操作。这样动效到达时不会重建已聚焦的入口。
- Send 来自 [官方注册表](https://animate-ui.com/r/icons-lucide-send.json)，保留 IconWrapper、SVG 和控制器，仅将默认返回式飞行动画改为 320ms 局部单次飞出。源码旁保留完整 MIT + Commons Clause 许可。
- 参考 [motion-web 的 motion-tokens](https://github.com/feitangyuan/motion-web/blob/5f4e40f1253e11e28850d08dce28b9b7e4320115/references/motion-tokens.md) 的局部 transform/opacity、快速按压和自然减速。范围仍以本验证计划为准，呼吸不引入额外业务轮询。
- 原基础目录中的工作台专属文案随 Home 代码加载，弹层文案随交互加载；保留原文、插值与官方 Lingui 编译。两项未被基础命名空间调用的重复命令文案仅保留现有 command 命名空间中的相同原文。完整双语测试覆盖 207 键、414 条消息。
- 根共享 Motion 固定到 14.6.0，管理端与原型声明同步；正式管理端严格类型与构建、原型构建纳入同次回归。实际首屏闭包仍由既有预算工具核验，自动后加载与交互后加载单独报告。
