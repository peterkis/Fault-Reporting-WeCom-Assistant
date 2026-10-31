# 桌面登录与验证导航

桌面扫码、准备态、工牌/背景、原生恢复及安装包任务从这里进入。业务与权限边界继续按[开发规则](development.md)，验证选择按[验证规则](validation.md)，交付与保全按[会话运行](session-operations.md)。

## 先选宿主和生命周期

| 目标 | 实现入口 | 对应验证 |
| --- | --- | --- |
| 首个远程文档响应前的本地准备态 | [chrome.html](../../app/pc-admin/desktop/chrome.html)、[chrome.css](../../app/pc-admin/desktop/chrome.css) | [原生导航回归](../../app/pc-admin/desktop/navigation-errors.test.mts)中的首屏断言 |
| 网页准备态、扫码场景整体出现 | [服务端HTML](../../app/server/src/workbench-embedded-login.mts)、[login.css](../../app/pc-admin/src/login/login.css)、[main.ts](../../app/pc-admin/src/login/main.ts) | [正式编译登录浏览器回归](../../tests/workbench-desktop-session.browser.test.mts) |
| 工牌、官方面板与提示投影 | [Lanyard.tsx](../../app/pc-admin/src/login/Lanyard.tsx)、[Lanyard.css](../../app/pc-admin/src/login/Lanyard.css) | 同一活iframe、拖动/翻面/缩放回退和提示朝向 |
| 背景生成器与帧率/像素预算 | [LoginBackdrop.tsx](../../app/pc-admin/src/login/LoginBackdrop.tsx)、[backdrop-renderer.ts](../../app/pc-admin/src/login/backdrop-renderer.ts) | 隐藏/离线暂停、销毁、背景提交与页面rAF分别测量 |
| 会话续期、网络/渲染恢复和可信窗口 | [main.mts](../../app/pc-admin/desktop/main.mts)、[policy.mts](../../app/pc-admin/desktop/policy.mts)、[preload.cts](../../app/pc-admin/desktop/preload.cts) | 原生导航、安全边界及[Electron编译集成](../../tests/pc-admin-electron.browser.test.mts) |
| 打包与版本 | [desktop.ps1](../../app/pc-admin/desktop/desktop.ps1)、[versions.json](../../app/pc-admin/desktop/versions.json)、[verify-package.mts](../../app/pc-admin/desktop/verify-package.mts) | ASAR白名单、实际包版本、源码字节与安装器哈希 |

一个准备动画可能横跨原生HTML/CSS和服务端HTML/网页CSS四处。网页发布与安装包独立生效；先确认用户看到的是哪一层，再选择更新方式。命令和版本以[桌面README](../../app/pc-admin/desktop/README.md)及实际脚本为准。

## 几何与准备态取样

逻辑尺寸取`offsetWidth/offsetHeight`或对应CSS值，变换后的外接矩形用于居中/边界检查。旋转的50px正方形外接矩形接近71px是正常几何；当前原生和编译浏览器断言已覆盖逻辑尺寸及居中。记录实际viewport、缩放和动画相位；截图文件名只是目标标签，不能替代运行时尺寸。

原生首屏可在合成首响应等待时取样。网页准备态优先使用正式编译浏览器用例，在样式生效、场景尚未ready时记录；ready后改查隐藏和停止动画。原生宿主下挂起defer模块的探针曾得到超时/0×0视口，这类结果只记探针失败，不计远端视觉通过。先确认`document.readyState`、实际视口和可见性，再解释截图。

首屏/组件的低成本检查先行，源码、版本及测试稳定后冻结候选。新指令改变目标时保留已运行/未运行结果，再绑定新候选；现有输入指纹和制品检查承担漂移检测，完整命令见[验证规则](validation.md)。原生模拟、正式编译浏览器、真实域名、实体手机/合盖及用户接受分别报告。

## 记录与发布消费端

构建输入、Git树、编译manifest、当前PR head和已部署源head各自绑定原始结果。后继文档提交保留被测祖先，不改写旧`tested_head`。SQL兼容profile的规范化等价、原字节差异及程序/web输出相同必须分别证明。

临时profile优先放在隔离的发布工作区。需要还原开发树的既有操作，应预先保存原字节/哈希及普通runtime的manifest/proof，分别记录“发布包冻结”和“普通树还原”结果；还原异常按已存哈希恢复后调用现有制品校验。当前没有新增通用发布框架或假定文件写入永不失败的检查。

消费报告前读取当前producer的字段：连接器可能把数据放在`structuredContent`，控制台可能只是摘要投影。摘要缺字段时追溯完整原件，例如发布`activation/result.json`；媒体文件数与原件数取本轮快照，数据库行数另记单位。原始缺失/失败保持显式状态，不能从历史常数或绿色健康检查补造结论。

## 合并与退役

按[会话运行](session-operations.md)核当前完整head、审查完成状态、未解决线程和CI。Codex新格式可能以可信bot的summary/receipt评论报告结果；空的formal reviews列表本身不能说明是否完成审查。下载原件核对源SHA、实际执行数与NOT_RUN；对象存储签名下载使用独立请求，输出只保留安全字段。

退役前先保全既有改动、恢复引用、忽略的原始材料和安装器，并给旧路径提供归档映射。检查Junction的实际目标；同卷移动链接对象后核目标和共享依赖，不遍历删除共享目标。托管工具返回queued时等真实终态；若把目录判为当前聊天主检出而拒绝删除，保留目录并在适当时detach，报告实际保留状态。聊天通用菜单的“归档”不能当作已完成工作树物理退役的证据。

本次问题、原始来源和改进取舍见[2026-10-31复盘](../retrospectives/2026-10-31.md)。本指南及指针位于现有文档检查器覆盖的`docs/agents`/`docs/retrospectives`内，复用既有CI与19项解析回归。
