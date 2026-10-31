# 用户菜单焦点与客户端版本显示

状态：WEB_DEPLOYED / CLIENT_0.1.6_INSTALLED / ENGINEERING_VERIFIED。用户2026-10-29要求移除截图中设置菜单项及设置弹窗外层的蓝色焦点框，并将标题栏“工单工作台”改为应用版本号。

在 `codex/desktop-login-expiry` 独立工作树接续0.1.5，保留此前未提交工作；尚未提交或推送。详细原件在 `.local/electron/focus-version-20261029/`，前轮记录及 tested_head 保持原身份。

## 实现与验证

- 仅对用户菜单项及设置弹窗表面移除蓝色焦点外框；菜单保留现有灰色选中反馈，弹窗保留柔和阴影。其余控件的焦点提示保持原规则。
- 标题栏版本由受信任主进程的 `app.getVersion()` 提供，以文本显示；0.1.6实际显示 `v0.1.6`，无独立手写版本常量。
- 1280及390宽度的正式编译页面、真实合成员工会话检查通过：菜单无outline和halo、背景为原灰色，弹窗无outline且保留原18px/60px阴影；Home/Enter打开设置、Escape回用户按钮均通过。四份截图及computed结果见 `visual-receipt.json`。
- 原生桌面7项PASS，包含实际安装包版本显示断言；strict/负向类型、最终统一构建、制品与文档检查通过，文档工具19项PASS。后继仅CSS和README调整，TS及原生源码未再变化。本次未重复上一轮39项业务回归或完整Electron/PG业务集成；full/certify、真实手机扫码为NOT_RUN_THIS_TASK。
- 无后端代码、Schema、依赖、持久Flag默认值变更，不修改提醒选项或权限。

## 发布及保全

2026-10-29 14:33–14:34（北京时间）部署到 `cd3120.mobimedical.cn`，活动owner为 `human-workbench-20261029-pc-focus-version-01`。47项Linux组件、图片/视频探针及32项健康检查PASS；42份既有配置原字节一致，30条迁移保持不变，本次无迁移apply；8份媒体文件含4份原件保护检查PASS。原服务端编译模块与H5输出全部字节相同，备份和旧owner保留，7份临时上传材料已精确清理。无新增真实试单或测试发送。

常规候选 input hash为 `1cfc582bac7ab1fcc72e6d368c7dd2037bdbc9bd6a7031edc4122442e4e3c20b`，manifest为 `764209e0e24b0411685ec8b7bce18f8226c6bc495d853b0de8f4fdb1b1a924dc`。发布通过维护构建入口沿既有六份部署SQL原字节生成兼容候选，仅CRLF/LF严格等价的032/035/037/067/068/069原字节发生输出差异，程序及网页字节不变；发布manifest为 `fd6f125cb06a3a26731419aa69a3e8eccf51524d062d0e1d52503bd7e88b42aa`。原检出及常规运行树随后恢复并通过制品验证，不重绑原被测身份。

用户完成系统管理员确认后，本机ProductVersion核验为0.1.6.0，安装app.asar与验证包一致，SHA-256为 `0d38e0938357de14c5e99e12e0e8d14745ea9295de73598bc3ad06633c54d56d`；安装包SHA-256为 `cc6b8e81dc0e8d3258613891957f46b32265799dcc7a595ef92be7c7d5256dc5`。实际观察标题栏 `v0.1.6`、既有会话进入线上工作台，并完成受保护刷新和菜单入口读取；弹窗像素及键盘细节结论来自上述本地正式bundle检查，不把工具捕获不完整的线上弹出层当作像素验收。

## 问题与资源收口

保留中间失败：移除outline后首次键盘检查发现选中行背景透明，补回既有灰色后两宽度检查通过；PG初次重启遗漏端口参数而落到IPv6 loopback默认5432，52741探针连接拒绝、未运行页面断言，停止精确自有进程后按原隐藏Start-Process方式显式52741重启。直接pg_ctl调用的进程挂接导致等待被中止，原日志保留。最终包装命令误将预期的pg_ctl status=3判为失败，但真实页面检查已PASS，独立关闭回执证实4个基线库恢复、PG停止及监听0；解释见 `verification-wrapper-reconciliation.json`，不抹除原退出码。

最终自有PG已停止，原数据目录保留；合成浏览器已关闭。上一轮被自动审批拒绝删除的profile保持原位，本轮不重试该删除。无真实业务回退执行，客户端回退使用保留的0.1.5安装包，服务器回退使用本release `operations/rollback.py --execute-authorized-rollback`。不推进P2-G2-LIVE、P2-008及后继Gate。

交付收据为 `.local/electron/focus-version-20261029/delivery-receipt.json`。

清理补记：自动审批拒绝了本任务 `deploy/regular-runtime` 可重建备份目录的删除，工具仅返回“blocked by policy”；目录保留，未换工具重试，不声称该部分清理完成。源检出与已恢复运行树、安装及服务器发布不受影响。
