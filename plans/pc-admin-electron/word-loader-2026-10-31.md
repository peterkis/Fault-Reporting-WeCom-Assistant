# 登录准备滚动文字

状态：WEB_AND_INSTALLER_DELIVERED / KNOWN_BASELINE_NATIVE_NAVIGATION_TEST_FAILURE / USER_ACCEPTANCE_NOT_RECORDED。输入为用户指定的[Uiverse kennyotsu fresh-lizard-20](https://uiverse.io/kennyotsu/fresh-lizard-20)及随后英文、常规字重要求；输出为本地启动壳和网页登录准备态一致的英文滚动文字加载效果。起始HEAD `131378f523f1331bd86d73ccdebe2676249d6c4f`，工作树干净，本会话唯一写者，沿已有登录UI提交/推送/服务更新授权交付。

## 范围与动效

替换两处西瓜loader，不改变加载/认证/故障恢复时机。固定“loading”，循环“login / QR code / badge / WeCom”，末尾重复第一项实现无缝循环；四种文字色为现有实心圆点的`#0784ef / #e5484d / #dca900 / #23a566`。按后续用户纠正仅使用英文，固定及滚动文字均为400常规字重，Arial优先，后备Helvetica Neue、Helvetica、sans-serif，不使用中文字体作为loader首选。保留参考4秒纵向滚动、2%轻微回弹和上下遮罩淡出，适配浅色页面。维持居中区域、固定100×40词列，只移动一条CSS文字轨道，无新依赖、网络字体、JS动画计时器或最短展示等待。完成后立即整体展示登录场景，隐藏/离线/ready时停止准备态轨道动画；读屏只获取稳定的加载状态，动态词不重复播报。

焦点为准备过程的一处文字切换；连续性为本地启动与远程准备同一视觉，交接沿原文档/场景就绪规则；反馈不伪造进度、不显示认证前工单骨架；预算为单个100×40裁切区的一条transform轨道。按用户既定要求默认完整动效，不新增减动选项或规则。

原550000背景预算/独立30fps/视口范围，工牌提示扫光/拖动/翻面、官方扫码面板、登录期限/回调、退出/版本桥、离线/重连及未确认操作保护均保留。无数据库/迁移、配置/Flag、业务POST或发送变更，不推进Gate。MIT归属与许可保留在源码说明、分发网页非可见注释及打包原生CSS中。客户端版本0.1.15：网页服务更新和本地安装包分别生效；旧版0.1.14原生首屏仍是旧loader。

## 验证与交付计划

一次最终源码构建、strict/negative、原正式登录浏览器相关1项、原生policy/navigation 9项、19项文档工具及制品检查；不降低原认证/拖动/翻面/单iframe/同屏呈现断言。增加滚动词、四种颜色、轨迹/回环、居中和ready后退出的既有断言。两种目标窗口尺寸及四个颜色停留相位做一轮视觉走查，核英文不截断、无布局跳动/旧西瓜、窗口按钮/离线恢复正常。用正式打包路径生成0.1.15安装器并核ASAR白名单/哈希；不代用户安装或退出其应用。

沿既有prepare/activate/postflight、公开静态表示和实际域名窗口检查发布；无迁移，仅保留已部署SQL原始换行兼容profile，所有程序/web输出与被测普通候选一致，完成后恢复普通制品。仅清理自有验证stage/profile/临时上传与可重建副本；保留回退owner/备份/失败原件。不跑full/certify、真实手机或物理合盖验收。证据目录`.local/electron/word-loader-20261031/`。

原生前置两次均为8 PASS / 1 FAIL：新loader的尺寸、颜色、轨迹和回环断言已通过；失败位于随后原测试hide/show后等待`document.hidden===false`。窗口和视图都为visible，renderer却仍hidden；自有窗口置顶实验未改善，已撤销该测试驱动实验，生产主进程完全不改。以起始HEAD的西瓜CSS/HTML、0.1.14包版本及原测试做历史诊断对照，也在完全相同断言失败，详见`baseline-experiment.json`/`baseline-navigation.log`；该对照是诊断性转译，不替代正式构建或新候选测试。不以重跑、放宽断言、关闭节流或改变生产恢复规则掩盖这项既有失败；完整原生导航不能标PASS，单列为本轮验证限制。

## 最终候选与实际结果

初始中文候选`3229f48def927cdceb3187010f38f2cc1e7787f5`及全英文候选`95b2c460fd6be735457255f3d813f5e9134bbdc8`随后被用户的字体要求取代，旧构建/类型/浏览器/安装包proof和失败日志均保留，不冒称最终验收。最终源码、被测及部署head为`9e56c91c6c73358778bda172db603d700c00955b`，tree `c1cfd4783eda0faa4c846879b6c6bd2beea7a4b2`。

最终`build-final.log`为911项语法检查、2739项输出；`types-final.log` strict/negative PASS，`browser-final.log`相关正式编译登录用例1 PASS / 0 FAIL / 0 SKIP（约48.4秒），`policy-final.log`原生策略8 PASS / 0 FAIL，文档工具19 PASS / 0 FAIL，普通制品及文档检查通过。该浏览器用例保留原拖动/翻面、单iframe、完整同屏出现、压缩及550k/30fps断言，并检查英文准备态、四种颜色、4秒周期、居中及ready后移除。完整原生导航的既有失败继续单列，上述通过不覆盖它。

本地首屏使用正式native Build产物、0.1.15宿主和自有HTTPS合成响应，实际检查1440×960及1920×1032视口（`1000`命名截图的原目标被窗口最大化替代，按实际viewport记录，不称1000验收）。8张四相位截图与`visual-check.json`证明Arial优先、固定/滚动均400字重，188.64×40区域居中误差小于0.01px；最长QR code字形宽98.67px，未超过100px词列，位移0/-40/-80/-120px。只为检查冻结动画相位，没有产品最短等待或源代码回退。原生挂起模块的远端探针曾等待超时/得到0×0视口，不计远端视觉PASS；最终远端准备态由上述正式编译浏览器验证，原生首屏由实际原生截图验证，失败日志保留。正常真实域名首次进入另行通过如下在线检查。

安装包`Yixiaoxiu-Workbench-0.1.15-x64-Setup.exe`为121320669字节，SHA-256 `0989a9cba49ba4fb23912bd46b90a17556585597e4067866243866aa678515a7`。正式Package与`package-proof.json`通过：ASAR恰为13项白名单，原生HTML/CSS与源码逐字节一致、两处loader规则一致、MIT许可保留；ASAR SHA-256 `51d9eb90a288803fd98829fabb27a50190726c13e91a1ade3103b2efa33d01f5`。没有运行安装器或修改用户安装/用户profile；本地首屏需由用户升级0.1.15，旧版0.1.14网页更新后仍可能先显示其原生西瓜。

## 服务发布与保全

已通过HTTPS推送源码并发布`pc-word-loader-20261031-01`至`https://cd3120.mobimedical.cn`，当前owner `human-workbench-20261031-pc-word-loader-01`。prepare 48 PASS / 0 FAIL / 0 SKIP，activate/postflight及32项readiness通过；6项公开逻辑资产的18项br/gzip/identity表示、解码/原字节SHA、HEAD/Vary和旁路拒绝通过，公开HTML英文词列及MIT、安全头、未认证工作台跳转通过。兼容构建期间的一次manifest读取未完成，已在普通制品恢复后顺序重做运行时比较：H5差异0，编译服务模块只变化`workbench-embedded-login.mjs`（固定HTML/许可），没有改变认证业务。

普通被测input `cf4d46d171878fbf1aea124a2e03ffadb3c795636ada43792e527f8cb4555d7e`、manifest `d4c9998a27344d432966fc7b65eb2f4e3ebfa583c6550cd7a13b02512b167a16`。部署兼容派生input `f77cdcfcae29bb4f50c205a08ec175f765542f965e8e85fd7f9c79d3b21c60bf`、manifest `a775275134c37434ec276746e8585cf228ae0d775373c2a60b72ca993d89be1e`。仅保留线上032/035/037/067/068/069六项SQL原始换行字节，规范化严格等价，所有程序/web输出与最终普通被测候选一致；源码、普通runtime和原proof已恢复，无迁移应用。

无证书绕过、无Provider替身的实际域名0.1.15窗口确认：1440×960、scene ready、shader、单一活iframe、工牌内原扫光提示保留；准备态实际CSS为Arial、固定/滚动均400，prefix loading及login/QR code/badge/WeCom/login，颜色与圆点一致；就绪后display none且animation none。短时背景29.86fps、页面rAF59.73fps，908×605=549340像素，原始rAF未替换。这是本机在线观测，不是功耗/真实手机/合盖/完整原生恢复验收。

42项配置、30项迁移记录、10项媒体（含5项原件）保留；无业务POST、测试发送、Flag、依赖或Gate变更。远端7项自有临时上传已精确清理，旧badge-caption owner、数据库备份和回退脚本保留。本地自有窗口正常退出code0，保留失败诊断原件后，核D盘绝对路径、无重解析点/活进程及普通制品恢复，清理21项自有临时stage/profile/regular-runtime副本。保留原日志/截图、普通及兼容manifest、唯一冻结发布包和最终安装器，见`owned-cleanup.json`及`deploy/delivery.json`。full/certify、真实扫码、物理合盖和用户接受未运行/未记录。
