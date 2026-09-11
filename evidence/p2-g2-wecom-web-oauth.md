# 医小修网页授权实施记录

日期：2026-09-11。状态：DEPLOYED / MEMBER_AUTH_VERIFIED。实现验证起点：`3c27c3fd80776a0fe2b3086036cf13b0e5cb3f81`，工作分支 `phase2/gate-p2-g2-rule-first-service-loop`；后续 Git 发布以 PR 的提交记录为准。OAuth-only 增量已部署并通过真实成员认证，完整 G2 业务运行仍停止。

## 授权与实现

用户明确要求使用 `https://cd3120.mobimedical.cn/wecom/yixiaoxiu/callback` 完成提供文档中的网页认证。文档来源为用户本地 `.firecrawl/wecom-document-96442.md`，包含 96440–96443；据此实现 snsapi_base、AgentId、一次性 code 换成员 userid。无需获取成员敏感详情。

- 入口：`/wecom/yixiaoxiu/login`，固定跳转企业微信授权域名；回调成功后 303 到 `/wecom/yixiaoxiu/`。
- 安全：随机 state 与浏览器绑定，5 分钟 TTL；服务端只存令牌摘要；code 一次消费、不重试；成员身份不进入浏览器响应；拒绝外部/互联企业账号。认证不等于工单归属授权。
- Cookie：`__Host-` 前缀、Secure、HttpOnly、SameSite=Lax、Path=/；响应 no-store、no-referrer、CSP。退出要求同源 POST。回调拒绝重复/未知参数，不接受事件 POST。
- 资源：单进程，待授权、已消费 code 和会话各上限 1024；会话 15 分钟；提供商调用并发 1、5 秒强制截止、64 KiB 响应上限。忽略取消的挂起提供商保持隔离，后续请求快速拒绝，避免累积后台请求。
- 关闭：`wecomWebOAuth.enabled` 默认 false；runtime stop 清空状态、拒绝晚到身份；进程重启需要重新登录。无数据库迁移、业务写入、发送或 AI 启用。

## 验证

TDD 记录：授权核心、提供商适配器、HTTP 路由的首个测试分别因模块缺失而 RED，再实现通过。后续新增挂起凭据测试在修复前于 6500ms 超时失败，补入强制 deadline 后约 5000ms 返回受控错误。其余安全边界用例作为后续回归增加，不追认为全部先 RED。

第一轮定向验证命令：

```powershell
node --env-file=.env.pilot --test --test-concurrency=1 tests/p2-g2-wecom-web-oauth.test.mjs tests/p2-g2-wecom-oauth-http.test.mjs tests/p2-016-reporter-surface.integration.test.mjs tests/p2-012-process-assembly.integration.test.mjs
```

结果：14/14 PASS，退出 0，无跳过；约 46 秒。包含本机真实 HTTP、模拟企业微信响应、真实隔离 PostgreSQL Reporter 权限验证和多进程停止/重启回归。企业微信提供商响应是测试替身，不是真实成员登录证据。

独立 SPEC 与 STANDARDS 审查均发现凭据等待超时缺口；修复后两轴复审通过。STANDARDS 复审另实跑核心 OAuth 10/10。未执行本增量全仓 954 项以上回归，不沿用旧就绪结论。

文档与 Backlog 同步后，V1.4 架构校验 407 项通过；限定路径 `git diff --check` 通过。

## 实际配置与停止线

用户随后明确确认 `.env.pilot` 中 `APP_SECRET` 用于本企业医小修应用获取 access_token，并提供 `.firecrawl/wecom-document-97164.md`。据此实现固定 gettoken 接口，无需 suite_token 流程。凭据仅经固定主机密钥校验的 SSH 传入自有云端及企业微信 HTTPS 接口；未输出凭据或 token。云端真实调用返回 `errcode=0`、`expires_in=7200`。

现有运行时组合入口接受如下内部配置；accessTokenProvider 必须来自经确认的服务端凭据流程，不接受浏览器传入 token/userid：

```javascript
import { createWeComOAuthCodeResolver } from '../src/p2-g2-wecom-oauth-provider.mjs';
import { createWeComAppTokenProvider } from '../src/p2-g2-wecom-app-token.mjs';
const accessTokenProvider = createWeComAppTokenProvider({
  corpId: configuredCorpId, appSecret: configuredAppSecret,
});
// Pass this option to createP2016Runtime / createP2012Runtime in the App process.
const wecomWebOAuth = {
  enabled: true,
  corpId: configuredCorpId,
  agentId: configuredAgentId,
  resolveCode: createWeComOAuthCodeResolver({ accessTokenProvider }),
};
```

## 已部署增量

新增 `scripts/p2-g2-wecom-oauth-serve.mjs`，在完整 App 未启用时作为唯一 OAuth-only App 运行，不连接数据库、Gateway、Worker 或业务 API。私有运行配置仅包含该应用凭据、域名、端口和认证开关；仓库及原持久业务 Feature Flag 未打开。

- 发布目录：`/opt/fault-reporting-wecom/oauth/releases/20260911-34d91172dc849c83`。
- 六个部署文件的 manifest SHA-256：`34d91172dc849c833ad32c09f4d5f9bf31c4b42c38cf3099e326e1e83121649c`；部署后回读匹配。
- 容器：`fault-reporting-wecom-oauth`，共享现有 nginx 网络命名空间，只监听 loopback 43123，无新增发布端口；只读文件系统、非 root、128 MiB、0.25 CPU、64 PID 上限、日志轮转。
- 仅对 `/wecom/yixiaoxiu/` 添加代理，固定 Host；该路径关闭 access/error 日志，避免 code/state 出现在代理日志。TLS、原静态服务及域名验证文件保留并校验。
- nginx 配置 SHA-256：`1a544e6156e4a43fcb95b2d2eb3999a8233d638e02e4a6a55add2f2fafd112ae`。原配置备份：`/opt/fault-reporting-wecom/oauth/backups/cd3120-d4e46c2fe922cfde.conf`。
- 公网验证：login 302 至固定授权域名、固定 callback、snsapi_base、安全 Cookie、no-store/no-referrer 均通过；缺 code/state 回调 401；事件 POST 404。无真实成员 code 在探测中发送。
- 部署后容器 running、restart_count=0；应用日志只有安全启动事件。私有健康记录仅保留成功回调和成功页面的聚合计数，不含成员 ID。

此轮 OAuth 专项测试 18/18 PASS。新增令牌缓存、并发合并、到期刷新、错误隔离、响应流取消以及独立服务器边界测试。两轴审查发现并修复“无效 code 误清共享 token”和“非成功响应未取消流”，两项先复现 RED 后修复通过；复审通过，STANDARDS 独立实跑 18/18。令牌错误码仅 40014/42001 触发失效，依据 [企业微信官方全局错误码](https://developer.work.weixin.qq.com/document/path/90313)，40029 不影响其他成员缓存；任何情况下不自动重放 code。

真实成员验证完成：用户在企业微信内打开 `https://cd3120.mobimedical.cn/wecom/yixiaoxiu/login` 后明确反馈“显示认证成功”。随后只读核验服务端 `authenticated_callbacks=1`、`authenticated_pages=1`，容器仍 running、restart_count=0，部署 manifest 与 nginx 配置摘要均未改变，应用日志仍只有安全启动事件。由此确认本企业应用的授权跳转、可信域名作用下的 code 换身份、服务器会话及成功页已完成一次真实客户端往返。没有记录原始 userid、code、state 或 access_token，也没有进行真实业务写库或消息发送。

关闭与回滚：停止 `fault-reporting-wecom-oauth` 即撤销内存会话和认证服务；如需恢复 nginx，先核验当前配置仍为上面的已部署摘要，再恢复备份、执行 `nginx -t` 并 reload，随后核验实际路由。共享网络容器 nginx 被重建时，须重新创建 OAuth 容器以绑定新网络命名空间。这里仅提供操作依据，未执行回滚。

本人工单主页、无单报修和具体卡片归属联动保持后续待办；本增量只提供网页成员认证，不把认证页面描述为已完成业务门户。持久 Feature Flag 均保持原值，未改变 P2-G2-LIVE、P2-008、其他 Gate 或 P3 状态。
