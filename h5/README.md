## 2026-10-20：V2 H5 实现入口

新版页面使用 Vite、strict TypeScript、React、React Router、TanStack Query、shadcn/ui（Radix）、Tailwind CSS 与 react-i18next，前向边界见 [ADR-0035](../adr/0035_yixiaoxiu_h5_multimedia_and_member_service.md)。本目录为实际产品源码，现有根构建管线负责正式制品和 HTTP 装配。

- [固定设计基线](design-baseline/README.md)：Stitch 项目“医院IT工单报修系统”的八个移动端屏幕、HTML、PNG 与哈希。
- `src/pages`：工作台、快捷报修、本人查询、工单详情和科室有限共享。
- `src/components/ui`：由官方 @shadcn registry 源码适配的组件，使用原稿的 Inter、Material Symbols 与主题变量；[components.json](components.json) 保留 CLI 配置。
- [Vite 配置](vite.config.ts)：同源 base `/wecom/yixiaoxiu/`，输出 `.build/emit/h5` 及 manifest。正式字体、CSS 与脚本均经 Vite hash 及依赖图登记。

本地开发先使用根目录锁定的依赖，不单独生成第二份锁文件：

~~~powershell
npm --prefix h5 run typecheck
npm --prefix h5 run dev
~~~

开发服务只监听 `127.0.0.1:5196`，`/api` 代理到显式本地宿主 `127.0.0.1:5197`。HashRouter 提供 `#/`、`#/report`、`#/reports`、`#/requests/{requestRef}` 和 `#/department`；本人 Bot 历史仍链接原 `/wecom/yixiaoxiu/tickets/{ref}`。

### 显式合成预览

仅 Vite DEV 且 URL 含 `preview=1` 时加载 `src/dev/preview.ts`。该模块拦截本地预览 API 和上传，无现场写库或外发。正式构建会消除模块、预览资料及照片。

~~~text
/wecom/yixiaoxiu/?preview=1&theme=light&lang=zh-CN#/
/wecom/yixiaoxiu/?preview=1&theme=dark&lang=zh-CN#/
/wecom/yixiaoxiu/?preview=1&theme=light&state=empty#/
/wecom/yixiaoxiu/?preview=1&theme=dark#/report
/wecom/yixiaoxiu/?preview=1&theme=light#/requests/11111111111111111111111111111111
~~~

`lang=en` 验证英文，`state=completed` 验证完工评价与未解决反馈，`submit=unknown` 模拟已提交后丢失响应，`submit=409` 验证版本冲突，`auth=403` 和 `error=503` 分别验证失权与暂不可用。预览结果不代替真实接口、实机和现场收件验收。

### 身份、媒体与恢复

所有业务读请求明确协商 `Accept: application/vnd.yixiaoxiu.v2+json`。写命令使用当前 Cookie、CSRF 与原 UUID；列表使用服务端 `search/status/source` 筛选、授权与游标分页，不在当前页过滤冒充全量查询。

报修文字与位置选填，纯录音、图片、视频或文字均可受理；“直接联系我”可不带材料。所有现场材料须上传完成后再绑定报修。企业微信原生录音、选择图片及辅助转文字由官方 `@wecom/jssdk` 提供；关闭 SDK 或普通浏览器使用能力检测后的 MediaRecorder／文件退路。识别失败不丢原录音，不实现图片 OCR。

草稿、Blob、Query 缓存和操作恢复仅在当前成员范围的内存中。Mutation 不自动重试。提交结果不明时保留原 UUID 和用途，页面导航后仍由同一成员范围的内存栅栏阻止第二次 POST，只能显式 GET 核对原操作。404 与暂时 503 均不能证明未提交。401／403 清除受保护内容；范围改变时卸载旧资料、媒体和命令状态。

语言优先使用企业微信 UA 的 `Language/…`，全部中文归为简体中文，其余为 English。主题按 `ColorScheme/Dark`、显式 Light 和系统偏好自动选择，恢复可见时重查。生产入口使用 CSS 深色首屏变量与 render-blocking 的同源模块；iOS／Android 企业微信的实际首次绘制、录音权限、原生取消和上传须单独实机验证，未运行项记为 `NOT_RUN`。

以下保留原后端交接要求；实际新增 API 与 DTO 以 [API 统一入口](../docs/api/README.md)及前向合同为准。

---

# 新医小修 H5 接入要求

本目录预留给新版页面设计。本次只交付后端接入要求，不生成页面布局。业务规则见 [ADR-0034](../adr/0034_mvp_notifications_and_application_members.md)。

## 身份与入口

使用既有医小修企业微信 OAuth 及同源 Cookie／CSRF。报修范围为当前应用可见成员，不逐人写报修名单；这不授予 PC 管理权限。开放身份与 Bot userid 不可互换。页面不能传入通知收件人、群 ID 或 Webhook。

后端显式选择 `memberEntry.identityMode=VERIFIED_APP_OPENID`，保持已核对的企业、应用、Bot 作用域和 proofRef。先核验并在授权数据库应用 063 增量迁移；启动不自动迁移。新成员不需要 reporterUserIds 或通知目标文件。可选旧名单和原资格文件仅兼容既有身份与记录；不得更换原 Reporter HMAC 或用开放身份冒充 Bot 原始 userid。配置、检查和关闭命令见[运行说明](../docs/runbooks/human-workbench-runtime.md#mvp-通知切换)。

## 接口

复用 [实际 HTTP 索引](../docs/api/endpoint-index.md)及[成员自助合同](../docs/api/member/self-service.md)：

- GET `/api/yixiaoxiu/bootstrap`：能力与当前会话。
- POST `/api/yixiaoxiu/requests`：创建报修，202 表示已受理，沿原 client_command_id 幂等。
- GET `/api/yixiaoxiu/my-reports`、`/api/yixiaoxiu/requests/{requestRef}`、其 `/timeline`：本人报修与进度。
- POST `/api/yixiaoxiu/requests/{requestRef}/supplements`：补充，沿原输入版本和命令恢复。
- POST `/api/yixiaoxiu/requests/{requestRef}/feedback`：明确仍未解决，重开原工单；按 [反馈合同](../docs/api/member/web-feedback-design.md)核能力与恢复。

路由、DTO、版本及失败以实际合同为准；页面设计完成后再装配其入口与 OAuth return path，不自行新增工单 API。

当前成员核验在业务事务前执行，最多 32 个等待项、一个实际查询，5 秒包含排队。等待后再检查本地会话和作用域。拒绝当前成员资格时返回 403；页面清除受保护内容。通知发送独立核验当前资格，不依赖浏览器继续登录。

资格查询暂不可用时返回既有 503，不把网络或 Provider 故障当作成员已退出。页面提示稍后重试。通知在实际发送前遇到这类故障，沿既有 Worker 有界重试；明确无资格仍拒绝，发送结果不明仍需人工核对。

## 通知与体验

实际接单／开始处理和工作人员完工时，由医小修应用向本人发送模板；后台保存报修时核验的收件绑定，退出登录不取消通知。无渠道来源标题；已受理为“工程师正在处理你的工单”。卡片进入本人进度，其他人不能凭链接读取。

页面展示工单业务编号、中文状态、当前进度和下一步动作，不展示数据库 ID、内部规则或投递术语。草稿恢复本期关闭；保留重复提交、版本和结果核对保护。界面文案采用短句、一句一事。

## 接入验收

新可见成员无需配置即可报修；非可见成员拒绝；本人可读、他人拒绝；补充和重复提交不产生重复工单；完工后反馈仍未解决沿原工单新轮处理；应用通知与会话、重启解耦。模拟接口结果不能代替真实设备收件验收。
