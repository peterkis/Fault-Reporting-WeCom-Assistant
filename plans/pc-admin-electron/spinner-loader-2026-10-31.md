# 登录准备 spinner

状态：WEB_AND_INSTALLER_DELIVERED / CURRENT_CHECKS_PASS / USER_ACCEPTANCE_NOT_RECORDED。用户提供完整HTML/CSS并要求替换滚动文字。起始HEAD `0f561e9ad76c1f1ae6ee58cfe785a93841c7b403`、工作树干净，本会话唯一写者。沿已有登录UI提交/推送/服务更新授权交付；本地安装由用户执行。

## 实现及边界

本地启动与远程准备均使用空的`.loader`，原样采用50px、aspect-ratio 1、50%圆角、8px `#514b82`边框和用户给定两套完整keyframes。裁切0.8秒linear alternate与翻转旋转1.6秒linear循环，沿当前border-box为50×50外框。没有可见文字、文字轨道、外部字体/脚本动画或新依赖。稳定无障碍名称保留英文Loading login page；就绪立即移除，不设置最短等待。隐藏/离线/ready停止准备动画，默认完整动效，不新增减动规则。撤下已不使用的滚动文字样式、DOM和活动第三方说明；原工牌扫光MIT许可、历史源码/日志/发布证据保留。

动效焦点为单个50×50区域内的等待反馈；两处同尺寸/颜色保证交接连续，登录场景就绪沿原规则整体出现。工牌/二维码/版本退出桥/认证与恢复规则、背景550000预算及独立30fps均不改；无配置/Flag、Schema/迁移、业务POST或发送变更，不推进Gate。客户端0.1.16，本地首屏需升级，网页准备态通过服务发布。

## 验证与交付范围

一次最终普通构建、strict/negative、原正式编译登录浏览器相关1项、原生策略/导航9项、19项文档工具及制品检查，保留原业务/工牌/单iframe/同屏呈现断言，替换既有loader尺寸/颜色/周期等断言。实际native首屏在1000×720与1440×960检查居中/裁切旋转相位及无可见文字，使用正式Build产物；远程准备态由正式编译浏览器用例验证。按原Package生成0.1.16、13项ASAR白名单与源码字节/哈希验证。原生完整导航在上轮及旧版基线存在hide/show可见性断言失败；本轮如仍同点失败保留原始结果，不重复调试、放宽断言或标成通过，见[既有记录](word-loader-2026-10-31.md)。

按prepare/activate/postflight及公开6项资产/18种表示验证发布，真实域名0.1.16窗口核对spinner样式、ready退场、背景/rAF及无业务桥；不扫描真实手机、不运行full/certify或物理合盖验收。保留线上SQL原始换行兼容profile，仅六项EOL等价派生，编译程序/web与被测普通候选完全一致，不应用迁移；完成后恢复源码/普通制品。关闭自有窗口，精确清理自有stage/profile/可重建副本和上传，保留原件/失败/旧owner/备份。Evidence `.local/electron/spinner-loader-20261031/`，关闭/回退沿旧word-loader owner和既有回退脚本。

## 最终结果与身份

实现提交`329f82ae`，最终源码、被测、部署head `3f6124177b52abd39d45f92fc597c5b9c0543327`，tree `ce60258945042017301a8e8fe108b01122e89589`。首次原生尺寸断言把旋转后的外接矩形约70px误当成元素逻辑50px；只将测试改为offsetWidth/offsetHeight，保留原样CSS，`native-tests.log`失败原件保留。为修正该断言，核对argv后仅中止本任务初始emit，原`build.log`为ABORTED而非PASS。最终`build-final.log`为911项语法检查、2739项输出通过，strict/negative通过；正式编译登录浏览器1 PASS / 0 FAIL / 0 SKIP（约45.4秒），原生策略/完整导航9 PASS / 0 FAIL / 0 SKIP（约25.4秒），文档工具19 PASS，制品及文档检查通过。上轮既有隐藏/恢复失败本轮没有复现；没有改生产恢复代码，不宣称已修复该历史问题。

实际native首屏在1000×720与1440×960各检查0/200/400/800ms四个相位，8张截图及`visual-check.json`通过：逻辑50×50、边框8px、rgb(81,75,130)、无可见文字/子节点，中心误差小于1px，裁切和旋转均发生变化。仅冻结CSS动画相位检查，宿主为正式Build，远程响应保持合成等待，不读取源码回退或改变产品等待规则。网页准备态的同尺寸/颜色/两周期、居中和整体场景ready退场由正式编译浏览器用例验证；原工牌拖动/翻面/单iframe/背景30fps及550k断言保持。

正式Package与`package-proof.json`通过：0.1.16 x64安装器121319922字节，SHA-256 `fdfa671a2a050f1f2edccbe535b385e7d89742f89b666ffd27d4b6f7323ee9ea`；ASAR恰为13项白名单，SHA-256 `4f166e85f84e4835f7bf2c65998a865545bb7136570ef75272fb8f6bea42daa3`。原生HTML/CSS与源码逐字节一致，两处spinner规则相同，旧滚动DOM已移除。未运行安装器或修改用户安装/profile；网页准备态已更新，本地首屏需用户升级0.1.16。

## 发布、还原与清理

已通过HTTPS推送并发布`pc-spinner-loader-20261031-01`至`https://cd3120.mobimedical.cn`，当前owner `human-workbench-20261031-pc-spinner-loader-01`。prepare 48 PASS / 0 FAIL / 0 SKIP，activate/postflight及32项readiness通过；6项公开逻辑资产/18种br、gzip、identity表示、字节/解码SHA、HEAD/Vary及旁路拒绝通过，空spinner HTML、扫码安全头与未认证跳转通过。H5输出差异0，编译服务只改变固定页面与许可所在`workbench-embedded-login.mjs`，核心认证/业务代码无变化。

普通被测input `486f890babaa5af3496fdebff462db1b6df465acb145b615f2c052a0a6b91b96`、manifest `1f1e592b48d3356f5e9eccb8dbc41baeb77c617b47cd13a23c11f958d1166a4f`。部署兼容派生input `567719ff44f1caf8246eaa36b5ba66e078ce6dc6901d842f8573d4e220177d95`、manifest `070e9d570be2befad7201a3c21b1c342bb6e096b47efc6cedf834108110eb2e5`。仅六项032/035/037/067/068/069 SQL原始换行字节与普通候选不同，规范化严格等价，所有程序/web输出相同，无迁移应用。冻结包成功后Python finally还原首项SQL出现OSError 22，原失败在`freeze.log`保留；随后从已保存普通runtime核对local_sha256，使用PowerShell逐字节恢复六项source/runtime SQL及原manifest/proof，原制品校验再次通过，Git恢复干净，冻结包未修改，见`restore-recovery.json`。

真实域名、无Provider替身/无证书绕过的0.1.16窗口确认：scene ready、shader、同一活iframe、工牌扫光提示保留；spinner实际CSS为50px、比例1、8px边框、指定紫色、空文本且子节点0，ready后display none与animation none。短时背景29.85fps、页面rAF59.69fps，908×605=549340像素，原始rAF未替换。不能将短时观测替代功耗、真实手机/合盖或用户验收。

42项配置、30项迁移记录保留，无配置/Flag/依赖、业务POST或发送变更。本轮启动前快照为8项既存媒体文件（含4项原件），activation/postflight逐文件及源事实保护通过；汇总最初沿用了旧发布的10项计数而拒绝通过，现按本轮完整activation原件与postflight独立核对8/4，不放宽保护合同，见`media-preservation.json`。远端7项自有上传精确清理，旧word-loader owner、备份与回退脚本保留；自有窗口正常退出code0，保存原失败/成功诊断后，校验D盘路径、无重解析点/活进程及普通制品已恢复，清理9项自有stage/profile/regular-runtime副本。日志/截图、普通与兼容manifest/proof、唯一冻结发布包和最终安装器保留，汇总`deploy/delivery.json`。full/certify、真实扫码/物理合盖NOT_RUN，用户接受未记录，业务Gate不变。
