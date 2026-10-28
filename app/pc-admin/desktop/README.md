# 医小修 Electron 工作台

2026-10-26：0.1.2将标题栏、最小化/最大化/关闭按钮全部自绘，原菜单收进右上角“更多”，与工作台浅灰白风格统一；本次仅更新客户端。验证与升级包见[标题栏交付记录](../../../plans/pc-admin-electron/titlebar-2026-10-26.md)。此前0.1.1修复主页面HTTP错误直接显示JSON的问题；服务器配套部署及本机扫码记录见[部署记录](../../../plans/pc-admin-electron/deployment-2026-10-26.md)。

Windows 10/11 x64 的信息科内部 MVP。客户端使用既有 HTTPS PC 页面和员工扫码身份，提供单实例、托盘和通用通知。业务数据、权限和发送仍由服务器持有。架构依据 [ADR-0047](../../../adr/0047_electron_pc_admin_mvp.md)。

## 开发环境

在 D 盘本项目根目录、PowerShell 7 中运行：

```powershell
./app/pc-admin/desktop/desktop.ps1 -Action Setup
npm run desktop:check
npm run desktop:test
npm run desktop:build -- -ServerOrigin https://cd3120.mobimedical.cn
npm run desktop:dev -- -ServerOrigin https://cd3120.mobimedical.cn
npm run desktop:package -- -ServerOrigin https://cd3120.mobimedical.cn
```

`Setup` 根据 versions.json 准备官方校验过的便携 Node.js 和锁定的 Electron/electron-builder，使用根依赖和根锁文件。所有入口先检查 D 盘包含关系、重解析点及写权限，再设置当前进程的 npm/Electron/builder/Node 编译缓存、TEMP/TMP、Node PATH 和测试 profile，不改系统环境。工具、缓存、临时文件、编译和安装包均在忽略的 `.local/electron/`。现有根 node_modules 和 .build 仍在本项目 D 盘。

`Build` 只从编译输出白名单准备 stage，不启动服务器。`Dev` 会实际访问指定服务器，使用前应确认访问范围。`Package` 生成 NSIS x64 安装包并验证 ASAR 恰好包含十二个宿主文件，拒绝夹带 root node_modules、服务端或私有配置；同时输出 desktop-build.json 与 SHA-256。测试驱动和源码映射不进入包。

开发/自动化 profile 由 `-Profile` 指定；运行包在开发机验收时也可设置绝对 D 盘 `WECOM_DESKTOP_DATA_ROOT`，主进程在 ready 前设置 userData/sessionData/temp/crashDumps/logs。同事正常安装使用 Windows 当前用户目录，不要求 D 盘。

## 服务器准备

新增 `GET /workbench/desktop` 复用正式员工扫码与一次性 intent，固定回到 `/workbench/app/`。不接受 return_to 或其他 query，不改变旧页面/API 认证响应。服务器必须部署本次认证入口与前端适配；仅安装客户端不能创建这些服务器能力。

human-v1 JSON 可增加 `"workbenchRemindersEnabled": true`，默认 false，仅传 App；H5 原有提醒不受此新增选项关闭影响。复用已有 realtime/reminders bootstrap 和对象 READ，无新数据库。实际员工仍须有已核实映射、内部有效角色及处理组；不会因安装客户端获得权限。

真实部署、员工配置、业务写入及企业微信收发沿具名授权，不由安装、构建、测试或本文件自动批准。详细验收记录见 [交付记录](../../../plans/pc-admin-electron/README.md)。

## 使用、退出与升级

顶部空白处可拖动窗口，双击可最大化/还原。右上角三个窗口按钮分别最小化、最大化/还原、关闭到托盘；“更多”（或 Alt+M）提供重新连接/登录、受保护刷新、编辑、页面缩放、版本和退出应用。标题栏保持40px，不随业务页面缩放。窗口控制和业务页面分别承载，远程页面不能调用标题栏IPC；弹出的功能菜单继续使用Windows原生菜单。

工单中的“下载原件”在完成服务器获权读取后打开原生保存对话框，由用户选择路径。仅当前业务主页面产生的同源、固定命名且有界的报修附件Blob可以下载，其他任意下载继续拒绝。

启动后独立扫码登录，沿用原会话有效期。窗口关闭进入托盘，双击托盘恢复；托盘“退出应用”完全退出，“退出工作台”撤销服务器会话。未保存/未确认操作会阻止退出、刷新和登录切换，先回原页面核对。关闭到托盘保留当前输入；human-v1 不提供退出后的草稿恢复。

桌面通知须每次新页面主动开启，初始静音。隐藏时继续获权提醒，实际已读和查看活动停止；锁屏/睡眠/断网暂停，恢复重建基线、不补响历史。通知内容为通用提示，点击先回窗口，再沿原 READ 和导航保护定位。Windows 通知关闭或勿扰模式不阻止正常办单。

安装包默认未签名，仅内部试用。先核对 SHA-256 与组织安装策略；不关闭系统安全设置绕过策略。安装后有开始菜单和桌面入口，可选择安装位置。手动升级前核对未确认操作并从托盘退出，安装器发现应用仍运行会拒绝继续，不强杀进程。升级/回退不会撤销服务器业务事实。

## 验证入口

先按仓库规则完成统一 migration:build 和 types/verify-artifact；`desktop:check` 单独覆盖 strict 主进程、CommonJS preload 和测试驱动。生产 Web 类型门禁也独立核验全部桌面 TS/CTS 已检查，不能靠排除 desktop 绕过类型。

```powershell
# 仅任务自有 loopback PG18 合成库；不得加载现场 .env 文件
$env:PILOT_DATABASE_URL = '<owned-loopback-test-database>'
npm run desktop:integration
```

集成测试使用真实员工会话、正式编译页面、真实业务 HTTP/PG 和三个独立 Electron profile；仅企业微信 Provider 是合成边界。TLS 仅在测试驱动中按本次自签证书 SPKI 精确接受，不修改系统证书库或生产证书策略。正常 full 中该测试明确 SKIP，须使用上述 Windows 专用入口实际运行，不能把 SKIP 当成功。测试驱动在退出时断开自有进程并清理合成数据库。

实体通知中心、真实扫码、Windows 10/11 两种目标电脑和实际企业微信送达各自单列，自动触发通知 click 事件不代表人工点击或实机送达。
