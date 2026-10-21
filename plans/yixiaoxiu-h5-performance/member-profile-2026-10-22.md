# H5 本人姓名与部门展示修复

基线为已合并 `937fed79fee4c979d6bb66f6eb50aec1f9f5614c`，执行状态及最终验收回执统一登记于 [Issue #113](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/113)。本文件记录缺陷来源、合同与验证范围；不将先前录音／性能候选的 PASS 改绑到本轮。最终完整源码、审查、CI、正式 manifest、云切换和资源清理以该 Issue 的交付回执为准。

## 已证来源

用户实际观察为 `USER_REPORTED_FAIL`：workspace 首页显示 “Good afternoon, colleague / Department not available”。[历史 H04／H04B](../../evidence/g0-005-active-push-matrix.md)及[逐接口记录](../../evidence/g0-005-http-template-card-20260922.md)已经证明代开发应用可读取非敏感姓名和部门名称；敏感 OAuth2 结果仍单列 H04A，不扩大授权结论。

当前代码中 `user/get` 姓名未连接到 H5 展示，Home 仅消费 entry 中的本地第三方目录投影。独立实际 PageRuntime／SessionProvider／Home greeting 探针保留自然 RED：单独把非空资料放入 Query bootstrap 缓存，当前页面依然为空；强制 entry 返回非空资料的正控制通过。云端只读诊断为目录快照／成员／绑定均 0，服务仍健康；只记录数量，没有读取或输出个人值，也没有进行 Provider 调用或业务写入。

原件分别保存在 `D:/wecom-workbench-evidence/h5-home-profile-diagnosis-20261022-937fed79`、`D:/wecom-workbench-evidence/h5-profile-diagnosis-937fed79` 及 `D:/wecom-workbench-evidence/h5-session-navigation-20261021-ccd73223/workspace-profile-20261022-01`；首次失败、原字节和候选身份保留。

## 修补与回归边界

[ADR-0039](../../adr/0039_h5_member_display_profile.md)及[展示接口](../../docs/api/member/h5-v2.md#本人展示资料)定义独立本人展示 GET：本次核验的开放身份读取姓名和主部门，原 BASE 单槽／队列／总预算，返回前保留会话及范围终检。前端只在展示消费者按需加载独立 Query，补缺少字段，保持原 entry、权限及所有写命令语义。无数据库变更、全员同步、新定时器或目录身份猜测。

独立审查发现的 P2 缓存问题单独保留 RED：30 秒过期但尚未 GC 时重新进入页面不重新取资料；修补限定展示 Query 在过期挂载时重取，30 秒内暖导航继续复用，不改变全局 focus／reconnect 刷新入口。

首轮私有 Vite 构建保留 `BUDGET_FAIL`：report 首屏所需全部 JS 为 122,883 B gzip，比原 122,880 B 上限多 3 B。原预算不变；统一取消异常的内部说明文字以减少公共脚本重复字符串，`AbortError`、取消信号和权限分支保持。新姓名／部门按合法最大长度增加局部折行规则，仍沿八屏双主题设计。最终预算及实际浏览器结果由本轮正式候选回执单独登记。

交付检查包括实际官方适配器响应、精确身份和部门对应、缺失字段／依赖暂不可用、BASE 排队及取消、等待时注销／换 Cookie、HTTP no-store／输入拒绝／权限终检、Query 去重／缓存新鲜度／旧响应隔离，以及 Home／资料弹窗的浅深主题和双语显示。执行普通 PR 的 strict、一次最终构建、相关注册测试、H5 tooling、首屏 120KiB gzip 和 2KiB 主题脚本原预算、制品核验及自有资源清理；未执行项和任何失败按实际回执保留。

真实 Android／iOS 当前姓名／部门显示与设备行为在未取得用户确认前保持 `NOT_RUN`；先前录音的实机音质仍 `NOT_CONFIRMED`。部署只沿用户本次会话已有授权，保留原配置、媒体密钥和业务事实；不发送消息、不推进 Gate。回退沿原页面／运行制品，不删除当前数据。
