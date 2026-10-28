# 桌面认证失效自动扫码（2026-10-27）

状态：IMPLEMENTED_VALIDATED_AND_DEPLOYED。用户要求 session/token 失效时直接显示企业微信二维码，省去“重新扫码登录”的额外点击。沿已有桌面桥与固定 `/workbench/desktop` 入口实现；普通浏览器、403、临时故障及主动退出保留原行为，不新增依赖、迁移、持久开关或安装包。

唯一写者为本会话。先以当前编译页面和真实 401 复现，再验证初始/使用中失效、并发失效单次跳转、恢复副本清理顺序、清理失败关闭、403/503 不误跳转及实际 Electron 登录入口。按持续授权部署同站点，保留业务数据、私有配置与上一回退版本，不新增真实试单或测试发送。修改前原件在 `.local/electron/auth-redirect-20261027/before/`。

## 实现与验证

生产改动仅在 `App.tsx` 和 `authorization.ts`：桌面 401 后先卸载旧业务视图，让原 beforeunload 保护完成释放；并发失效共用正在进行的撤权清理，再确认原生上下文已关闭并调用已有 `requestLogin`，单次进入二维码入口。原 IndexedDB 清理未确认时不自动跳转；不重放任何业务 POST，不改变凭据、权限或服务端认证寿命。

旧编译制品实际 401 复现为 `loginRequests=0, expiredPage=true`；当前正式制品相同复现为 `loginRequests=1, expiredPage=false`。原件是 `.local/electron/auth-redirect-20261027/repro-red-06.log` 和 `repro-green.log`。此前几次触发未命中的诊断保留，不计作目标问题的 RED。

- 5 个相关注册入口最新结果 **21/21 PASS，0 SKIP**：自动登录 6、原工作台浏览器 9、离线 2、实时更新 2、取消隐私边界 2。`verification-summary.json` 记录各轮候选及原始报告，并逐一核对通过用例源码和 215 份实际加载文件与最终制品相同。
- 实际 Windows Electron 三人流程在最终制品上 **1/1 PASS**：原三人竞争、完工、后台提醒和禁止后台已读保持；身份撤销与真实员工会话撤销后，每个受影响窗口各进入一次合成 Provider 登录页；原生提醒在离开业务页前关闭，登录页没有业务桥，不出现额外离开确认。见 `native-final.log`。真实企业微信扫码和物理通知体验不冒称本地合成验收。
- 自动登录测试覆盖初始 401、带加密未提交输入的使用中 401、并发失效、清理失败不跳转、403/503 不跳转、普通浏览器保留原入口，并验证 0 业务 POST。
- 统一构建、894 份编译文件语法检查、strict/负向类型、制品校验、19 项文档工具及差异空白检查通过。初轮普通浏览器检查因动作读取尚未完成而定位过早，改为先观察就绪并允许其他在途请求先触发失效。两条旧离线测试仍引用此前移除的附件刷新按钮，改为真实的现有辅助刷新时钟及新的接单模态确认；故障限定在动作读取端，保持资料 READ 独立可用，原禁止错误提交断言保留。首轮 18/21、第二轮 7/8、最终自动登录 6/6 的原始结果均保留。

自有 PG18 52690 已恢复四个基线库并停止，0 其他客户端、0 监听；两个成功 Electron 轮次产生的 6 个临时 profile 和 2 个 stage 已在核验路径、非链接、无活动进程后删除，必要合成截图已单独保留。原有安装版、配置及其他 profile 未清理，见 `native-cleanup.json` 和 `pg-closure.json`。

## 候选与部署

HEAD 为 `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加本地差异；最终输入 SHA-256 `32abfa491f493e8ef8979e6af186542e14d816144e41ceac3a2b606358e04758`，manifest SHA-256 `b8f5a7462dec55d89b614cd954a463f36d0989cfee4178e6a97356521b90e68f`，2677 份运行输出。相对上一部署，后端、SQL、依赖和 H5 产物校验值保持不变。

归档 SHA-256 `572385c8d9d070d8bb99aeba7c61d45ffb0c516573ee5be97093fda2348f82dc`，部署版本 `pc-auth-redirect-20261027-01`，活动 owner `human-workbench-20261027-pc-auth-redirect-01`。服务器 **45/45 组件、31/31 ready** 通过；前版 `human-workbench-20261027-pc-detail-flow-01` 已停止并保留回退。42 份私有文件、8 份媒体文件及切换前后的业务/权限摘要一致：10 个入口材料、10 张工单、20 条媒体元数据、13 次通信尝试、0 次通知尝试。

部署收据位于 `.local/electron/deploy-auth-redirect-20261027/`，包括 `server-identity.json`、`prepare-01.json`、`activate-01.json`、`postflight-01.json` 和 `cleanup-upload-01.json`。只清理本次上传暂存，活动版本与回退版本保留；没有真实试单或测试发送。

安装版当前已登录且打开工单，未强制刷新或打开其他真实工单。用户处理完当前编辑/未确认操作后按 Ctrl+R 加载本次前端；之后认证失效自动进入扫码页，无需重装。当前仅保存无业务内容的 `live-client-check.json`。本轮未提交、推送、运行 full/certify 或推进其他 Gate。
