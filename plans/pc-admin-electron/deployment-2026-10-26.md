# PC 配套部署与客户端 0.1.1

日期：2026-10-26（Asia/Shanghai）。用户在本会话具名授权部署到 `cd3120.mobimedical.cn`，保留业务数据与回退版本，不新增真实试单或测试发送，并验证启动、扫码及进入工作台。

## 已完成的服务端部署

- 状态：`PASS_ACTIVATED`，部署后独立读回 `PASS_POSTFLIGHT`；29/29 readiness，0 restart、无 OOM、唯一活动工作台实例。
- 新实例：`human-workbench-20261026-pc-desktop-01`；新目录：`/opt/fault-reporting-wecom/p2-g2/pc-desktop-20261026-01/runtime`。
- 发布的是上一轮已验证并在本次编辑客户端前冻结的服务端/PC页面制品。manifest SHA-256：`ca3d3b5d17083004e3c53be6ee4c8efe31a376828da9914aa718448c23c0ca11`；2648份输出逐文件核验。来源是基线`3bd9f037af6933f3717a95e173cacfcd0ea4bd4e`加当时工作区，`source.dirty=true`，不冒称已提交或已合并。
- 服务器按锁文件仅安装生产依赖；隔离、断网、无配置挂载的Linux组件检查28/28 PASS，0 FAIL/SKIP，随后才切换。
- `/workbench/desktop` 已从404变为302到企业微信员工扫码入口；匿名`/api/lifecycle/bootstrap`仍401。H5当前页面200且匹配制品，前一代H5入口资产200且哈希一致。
- 42份原配置逐文件哈希相同；8份实际媒体文件哈希相同；业务受理10、工单10、媒体记录20，部署前后数量不变。26条迁移回执及SQL checksum匹配；本次未执行迁移、业务POST或测试发送。
- 常态收发开关沿原配置，未增开AI、P3或后续Gate；部署成功不代替业务Gate批准。

原件集中于项目忽略目录 `.local/electron/deploy-20261026/`：`server-identity.json`、`preflight-02.json`、`prepare-01.json`、`activate-01.json`、`postflight-01.json`。新包SHA-256为`ee708cb907212f479541c24c84196600a4cbbd7ec57d2d11c0e055e5636654da`，8148740 bytes。首次只读预检因历史容器挂载目标与假定的`/app`不同而拒绝，修正为实际`/opt/yxx-app/runtime`后通过，原失败保留；拒绝阶段没有修改服务。

## 回退保留

旧实例`human-workbench-20261022-h5-loading-117-01`已正常停止且保留，ID为`3d36073dfe8d423cade52d0e8a4a6e84bdee55e486dfe6bd7825ca95a192eaf4`。旧运行目录、旧配置、媒体目录和旧H5资产目录均保留。

新发布目录的`activation/`保留切换前后systemd单元及操作收据。`rollback.py`默认拒绝执行；只有后续明确回退指令下使用`--execute-authorized-rollback`，核验当前/旧实例和单元身份后恢复旧实例并等待29项ready，再恢复HTTP桥。此脚本已保存，未执行。回退不删除数据库事实，也不重发UNKNOWN。

## 客户端修复

版本0.1.1新增主框架HTTP状态处理。404桌面入口缺失、401/403授权失败、5xx服务异常及其他页面错误分别显示固定中文说明，不展示响应JSON、正文或认证查询。网络/证书失败继续使用本地错误页；重连只执行原登录GET，不重发工单操作。

使用真实Electron进程和隔离HTTPS服务器先复现RED（404仍显示原始JSON），修补后4/4测试PASS：真实404、403、503和200页面，以及导航/IPC输入校验。测试驱动和证书均不进入安装包。记录：`.local/electron/logs/http-error-red.log`、`http-error-green.log`。

0.1.1安装包：`.local/electron/releases/Yixiaoxiu-Workbench-0.1.1-x64-Setup.exe`，121311314 bytes，SHA-256 `606db3aefe8d00a0fabb262c3ffc63569efe59d77442d25237faa205635cc66e`。8项ASAR白名单、当前编译字节和哈希校验通过。0.1.0安装包及其`desktop-build-0.1.0.json`保留，不覆盖回退包。

服务器发布身份仍绑定冻结的ca3d制品；客户端0.1.1在独立桌面编译和测试入口验证。本次未因客户端主进程/本地错误页的改动重编或重绑已经冻结部署的后端制品，也未把旧证据标为新的完整回归。

## 本机更新与登录验证状态

首次更新尝试：原安装为`D:/Program Files/wecom-it-workbench`的全用户0.1.0。观察其404 JSON页面后，通过应用菜单正常退出，没有强杀。0.1.1安装器校验SHA后申请Windows管理员权限，Windows返回“操作已被用户取消”；该次更新没有执行，原失败保留。

后继确认：用户已完成管理员确认，明确回复“已更新到0.1.1”和“我已经完成登录”。实际exe版本读回0.1.1，已安装`resources/app.asar`的SHA-256为`fcc5b87bf07509941895da8e49f6bc4de1f52f093fee99eebe5a6d83511628e9`，与0.1.1发布包一致。

通过原生窗口只读核验，当前页面为`https://cd3120.mobimedical.cn/workbench/app/`，可见“已授权内部身份”“团队工作台”“实时更新已连接”和“退出工作台”；未见`WORKBENCH_NOT_FOUND`或会话错误。启动与企业微信登录进入工作台验证完成；认证由用户本人操作，不使用测试Cookie或临时扩权。未操作工单、未发送测试消息，也未保存工单正文、人员资料、Cookie或认证查询值。

最终本机状态：`PASS_INSTALLED_CLIENT_LOGIN`。脱敏核验收据：`.local/electron/deploy-20261026/client-login-verification.json`。本机应用保持打开供用户使用。本结论限于本次部署、0.1.1安装及本人登录；其他同事电脑、真实消息通知送达和业务闭环现场试用不据此补记通过。
