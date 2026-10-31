# 长时间等待扫码后的双次登录修复

状态：FIXED / INSTALLED_0.1.4 / ENGINEERING_VERIFIED。来源为用户2026-10-29报告：PC长时间未扫码，第一次手机确认后显示“暂时无法打开这个页面”，需手动重新连接再扫一次。

基于 `ff040732de9f1769acdefc8feecce0557055c3c4`，在独立工作树实施；原主工作区的未提交文档和历史材料保持原位。证据位于 `.local/electron/login-expiry-20261029/`。

## 根因与原始证据

员工登录intent和浏览器绑定Cookie有效期均为300秒。企业微信二维码页未同步更新桌面登录intent，扫码确认回到已过期state，应用在交换code前拒绝，返回400；桌面导航将其变为本地page错误页。

`node .local/electron/login-expiry-20261029/repro.mjs` 对原编译认证handler及桌面策略回放六分钟等待：status=400、desktop_error=page、Provider code交换0次。原生回归也先得到RED：第二代二维码等待超时。旧回放保留用于解释原始故障，不把接受过期state视为修复。

## 修复与边界

- 只有当前业务WebContents的主frame、GET、固定同源 `/workbench/desktop` 的302响应，可从已有intent Cookie的唯一合法Max-Age安排刷新。300秒凭据在240秒更新；外站、其他路径、子frame、XHR及重复/非法/超过300秒的寿命不触发。
- 始终重新进入固定桌面入口，生成新state和绑定；聚焦、恢复及解锁时检查等待时长。每窗口最多一个定时器，进入回调即取消；成功进入业务页及窗口销毁时清理。
- 已开始的桌面登录若收到400回调，自动回到新二维码。403、503和网络故障沿原处理。待确认回调不会被刷新替换绑定。
- 服务器源码、Schema、认证寿命、一次性消费、员工准入、沙箱和业务命令不变；无新依赖、IPC或开关，不重放业务POST。客户端版本0.1.4，更新桌面即可。

## 验证与问题

最终结果在验证及本机升级后追加。相关入口为migration:build、strict/负向类型、desktop:test、desktop:integration、已注册员工认证unit/PG入口、制品和文档检查。实际手机扫码与合成确认分别报告。

保留中间失败：fixture初次HTTP状态误写为字符串被strict拒绝；两次构建分别因测试驱动和桌面README仍被修改而被源指纹门禁拒绝，稳定输入后重新构建；认证回归首次报告目录位于源码树而被拒绝（用例NOT_RUN）；PG整合首次用未来时钟创建session，真实时间撤权违反约束，改为旧intent在过去建立、续新后回归当前时间，未放宽数据库约束。

## 最终回执

最终构建 input hash 为 `c274deecf24a76299c14c8ab7b463600a171979c7443be0acc2063a4f88f4b60`，manifest SHA-256为 `eda2394f9cf119eb92a0ea987e4e80c051eb721f8297c1f34b4433b732cdb734`。统一构建、strict/负向类型、制品核验PASS。

- desktop:test 7项PASS：二维码到期前更新、一次确认成功、回调在途不替换绑定、休眠恢复刷新、过期回调自动恢复，以及原错误页、下载、窗口和安全边界。
- desktop:integration 1项PASS：真实Electron、正式编译前端、隔离PG与模拟Provider；旧intent在六分钟前建立，换新后第一条确认即登录成功。原三人竞争、闭环、隐藏提醒、通知定位与撤权断言保留。
- 注册认证unit/PG共10项PASS，文档工具19项PASS；非full/certify。
- 0.1.4安装包SHA-256为 `7a0666e8f301e65f41361a7ebd6c70768c55025c01ece2574618e4d02c2adbed`。本机正常退出0.1.3后安装并启动，ProductVersion=0.1.4.0，app.asar与验证包一致，原会话直接进入工作台。服务器未改动，无真实试单或测试发送；实际手机扫码NOT_RUN。
- 自有PG18恢复4个基线库后关闭，52739监听0、pg_ctl status=3，精确删除本任务新建合成cluster。测试Electron进程0。删除临时测试profile的操作被自动审批拒绝（未给详细原因），原目录保留，不称清理完成。
- 修改保留在 `codex/desktop-login-expiry` 独立工作树，尚未提交/推送；未覆盖原main的其他未提交文档。

回退使用原0.1.3安装包，正常退出客户端后覆盖安装；不删除用户profile、Cookie或业务数据。交付收据为 `.local/electron/login-expiry-20261029/delivery-receipt.json`。

后继说明（2026-10-29）：0.1.5用户菜单/本机提醒任务实机复核发现企业微信规范尾斜杠路径遗漏，已前向修补并重新运行原生7项。0.1.4的原始回执及NOT_RUN不改写；0.1.5安装和发布详见 `user-menu-2026-10-29.md`。
