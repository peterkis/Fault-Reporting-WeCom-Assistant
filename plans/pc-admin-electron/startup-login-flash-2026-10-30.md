# 启动前工作台骨架误闪（0.1.11）

状态：**NATIVE_011_STARTUP_FLASH_FIXED / CHECKS_PASS**。用户报告打开应用先出现约0.5秒工单工作台骨架，再显示登录页。本轮仅客户端启动壳及其可见状态修补，不修改已认证工作台的真实加载流程或服务器。

原正式宿主挂起HTTPS首个响应后已RED：窗口自然ready-to-show，远程view仍隐藏，本地chrome.html却包含“医小修·工作台”和三列startup-columns；截图与用户现象对应。因此来源为认证前的本地占位，不是请求先进入真实工单页，也没有证据表明曾读取业务数据。原测试及截图保留 `.local/electron/startup-login-flash-20261030/native-red.log` 指向原件，八份源码/哈希及旧0.1.10打包回执已保全。

修复以中性品牌连接画面代替业务骨架；本地可信ChromeState增加booting标记，首个远程文档显示前隐藏身份/版本/更多，保留三个窗口控制，首个有效DOM显示后清除启动状态。保留原窗口自然显示及远程view首次绘制隔离，不以隐藏整个窗口或固定延迟掩盖闪烁。进入已认证业务后恢复原40px标题栏，登录保持原完整视口。

验证目标：原生挂起首响应场景从RED到GREEN，检查认证前无业务骨架/标题、可见三个窗口控制及首文档后启动区隐藏；保留原导航、媒体偏好、登录桥、版本、退出及beforeunload测试。完成统一构建、strict/negative、相关文档/制品检查与0.1.11十三文件白名单打包，再以独立客户端核对启动和登录。无服务端部署、业务试单/测试发送、迁移、持久flag修改、Git提交/推送或后继Gate推进。

## 修补及验证结果

普通候选input `481b2892d6b2eeb04a9f9adcb0be9bec3a2e3fcd659aaa8effd855024a7cf155`、manifest `3057e658b8a87359dc9c37828fd6e692f0d92495d65d6e2d7786c9553ede8eb6`。统一构建、strict/negative、原生9项、文档工具19项、制品/文档检查PASS，无SKIP。RED实际8PASS/1FAIL，旧首屏截图为三列假工作台；GREEN在同一挂起响应路径保留窗口自然可见及远程隔离，要求无骨架、无工作台文案、仅三个可见窗口按钮。第一远程文档显示后启动区hidden=true，真实业务导航恢复40px标题栏与更多菜单；原登录/版本/媒体/退出及未保存守卫继续通过。原RED、两次GREEN、截图及哈希原件保持独立，不把新结果重绑到0.1.10。

实机正常冷启动窗口593020/PID17716未被驱动强制show。首个show的公开状态为windowVisible=true、remoteVisibleAtShow=false、booting=true、startupVisible=true、workbenchColumns=0、visibleWindowControls=3；随后实际官方工牌页面panel=1、canvas=1、appVersion=0.1.11、减动false且无业务桥。已目视核对中性启动与实际工牌登录，证据为 `real-first-show.json`、`real-login-ready.json` 及原profile内 `first-show.png`。该实机范围是本机正常启动，慢网/未响应由挂起HTTPS注册场景验证；没有声称所有设备或真实手机/休眠/业务验收。

安装包 `Yixiaoxiu-Workbench-0.1.11-x64-Setup.exe`：121317997字节，SHA-256 `f31acadfbbe6b69f049112ebc089849ac77ef49d63958ca6f7f749679c2540c1`，ASAR `8958d84ff13e5bbe779f1a17e67ec4f0f647f0d9a91b04d9c4aae5b06abb1341`。十三文件白名单通过；另外直接核对ASAR中的chrome.html/chrome.css哈希与本次源码相等，防止只修源码未进包，见 `package-startup-proof.json`。未运行安装器、未覆盖已安装版本；旧0.1.10安装包和回执保留。

本轮没有服务器部署、SQL兼容派生或业务数据操作，既有服务器保持原发布身份。普通运行树已验证，当前独立0.1.11窗口保留供用户查看，最终汇总见同任务目录 `delivery.json`。无提交/推送、full/certify或Gate批准。
