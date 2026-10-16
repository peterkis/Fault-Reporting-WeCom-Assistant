# 后端调用的外部服务

返回 [导航](../README.md) · [项目HTTP索引](../endpoint-index.md)

这里描述**仓库适配器的请求和返回校验**，不是外部厂商全部API目录。浏览器不能直接调用这些后端Provider或拿到应用token。Vendor协议升级时需另核对官方资料；本轮没有在线调用、抓取个人资料或启动SDK。

## 企业微信HTTP与认证跳转

API origin=`https://qyapi.weixin.qq.com`。只有经过现有部署/现场授权的adapter可访问；各自默认关闭或需显式注入配置。

| METHOD + PATH / URL | 调用方 / 输入 | 接受的返回与目的 | 源码 |
| --- | --- | --- | --- |
| `GET /cgi-bin/gettoken` | 后端；query corpid/corpsecret | errcode=0、access_token、正expires_in；闭包缓存/提前刷新，单飞、5秒deadline | [app token](../../../src/p2-g2-wecom-app-token.mts) |
| `GET /cgi-bin/auth/getuserinfo` | 后端；access_token/code | errcode=0、合法userid→`{userid}`；一次性code不自动重放，5秒deadline | [OAuth provider](../../../src/p2-g2-wecom-oauth-provider.mts) |
| `POST /cgi-bin/batch/userid_to_openuserid` | 后端；access_token；JSON `{userid_list:[...]}` | errcode=0、完整无歧义open_userid_list，无失败成员；namespace官方映射 | [成员映射](../../../src/p2-g2-yixiaoxiu-delegated-identity.mts)、[员工映射](../../../src/p2-016-workbench-wecom-auth.mts) |
| `GET /cgi-bin/user/get` | WeCom目录adapter；access_token/userid | errcode=0、userid匹配、合法department；规范化name/mobile/telephone/status/main_department | [member directory](../../../src/p2-015-wecom-member-directory.mts) |
| `GET /cgi-bin/department/get` | 上述adapter；access_token/id | department.id/name；失败可保留membership名称为空，不能阻断明确报修 | [member directory](../../../src/p2-015-wecom-member-directory.mts) |
| `POST /cgi-bin/webhook/send?key=<secret>` | 专用群关闭sender；固定text模板、mentioned_list | HTTP成功且errcode=0认ACK；未知结果人工对账；每群每分钟≤20 | [group closure webhook](../../../src/p2-016-group-closure-webhook.mts) |
| `GET https://open.weixin.qq.com/connect/oauth2/authorize` | 浏览器跳转；appid/agentid/redirect_uri/response_type=code/scope=snsapi_base/state | 成员OAuth回调到本项目 `/wecom/yixiaoxiu/callback` | [web OAuth](../../../src/p2-g2-wecom-web-oauth.mts) |
| `GET https://login.work.weixin.qq.com/wwlogin/sso/login` | 浏览器跳转；login_type=CorpApp/appid/agentid/redirect_uri/state/lang=zh | 员工扫码回调 `/workbench/callback` | [workbench auth](../../../src/p2-016-workbench-wecom-auth.mts) |

WeCom目录还需enabled、memberIdsConfirmed、bot范围和token provider；未满足返回DEFERRED。bot成员ID与delegated app ID不能直接互换；user/get失败不是自动判定账号无效的依据。

合成映射请求形状（不得填真实成员ID/token到文档）：

```json
{"userid_list":["<approved-bot-member-id>"]}
```

读取外部响应之后只保留adapter允许字段，错误码/失败通过本地Provider边界转换；外部errcode=0不证明本项目已落库、已外发或客户端已显示。

## 第三方人员目录HTTP

当前adapter只允许精确base `https://rd-api.mobimedical.cn/8024`，不是可任意替换host的开放代理。默认 `THIRD_STAFF_DIRECTORY_ENABLED=false`。WORKER请求Provider；APP读取PostgreSQL目录投影；GATEWAY不启用目录。

| METHOD + 完整URL | Form输入 | 返回校验 / 规范化结果 |
| --- | --- | --- |
| `POST https://rd-api.mobimedical.cn/8024/token/getToken` | key | result="TRUE"、data.token；缓存 |
| `POST https://rd-api.mobimedical.cn/8024/token/getOrganizationTree` | token、parent_id、get_user=get | result="TRUE"、data数组→departments/members/memberships/snapshot_version/counts |
| `POST https://rd-api.mobimedical.cn/8024/token/getUserInfo` | token、uid | result="TRUE"、data.user_id/employee_id/nickname/phoneno/sex/avatar→PersonProfile；必要时核对本地成员 |

[adapter](../../../src/p2-007-third-party-staff-directory-adapter.mts)、[规范化/limits](../../../src/p2-007-staff-directory-contracts.mts)、[进程配置](../../../src/p2-007-third-party-staff-directory.mts)、[Provider说明](../../66_p2_007_formal_third_party_staff_directory_provider.md)。失败/字段缺失走既有有界降级，不伪造权威人员身份。不存在供浏览器读取原Provider响应的REST透传入口。

传输使用 `application/x-www-form-urlencoded`，redirect:error；请求deadline可配置且最长30秒。目录上限5000部门、20000成员、40000 membership、深度16；tree/token/detail响应上限分别4MiB/64KiB/256KiB，超限拒绝规范化。

## WSS与SDK（没有本项目REST入口）

`wss://openws.work.weixin.qq.com` 经 `@wecom/aibot-node-sdk` 的WSClient单活访问。[Gateway](../../../src/p2-g1-wecom-gateway.mts) 的start/stop/getAuthenticatedClient/getStatus；client.connect/disconnect/sendMessage；监听authenticated、message.text、disconnected、error。全局活动连接最多1，reconnect attempts=10，auth failure attempts=1。

群内 @Bot 的实际入站为 `aibot_msg_callback`：`body.chatid`提供群ID，本次真实回调未提供群名称。完整字段、来源识别方式及2026-10-07最小现场回执见 [消息回调契约](wecom-message-callback.md)。

[G1 sender](../../../src/p2-g1-wecom-sender.mts) 把text/markdown转为SDK markdown，检查目标hash allowlist；[P2-016 sender](../../../src/p2-016-wecom-sender.mts) 增加模板卡片/Reporter绑定。结果分类 `ACKNOWLEDGED|REJECTED_NOT_APPLIED|UNKNOWN`，必须经过Communication Outbox/Delivery；浏览器和AI Worker不能直接调用SDK。

G0冻结工具另有replyWelcome/replyStream/reply/replyTemplateCard/updateTemplateCard/uploadMedia/replyMedia/downloadFile，以及webhook `POST /cgi-bin/webhook/upload_media?key=<secret>&type=file|voice`（multipart media→media_id）。见 [G0 reply](../../../src/g0-006a-reply-capability.mjs)、[card](../../../src/g0-006-template-card.mjs)、[media](../../../src/g0-004-media-capture.mjs)、[webhook probe](../../../src/g0-webhook-message-capability.mjs)。这是冻结验证工具能力，不是新增可调用的业务HTTP服务。

## 配置名称与核对入口

只列变量名，值不得进入文档：

| 边界 | 配置名称 |
| --- | --- |
| 应用/OAuth | CORP_ID、APP_ID、APP_SECRET、WECOM_WEB_OAUTH_ENABLED、WECOM_WEB_OAUTH_ORIGIN、WECOM_WEB_OAUTH_PORT |
| 成员 | YIXIAOXIU_RUNTIME_PROFILE、YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED、YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG、P2_G2_REPORTER_HMAC_SECRET |
| 员工 | WORKBENCH_WECOM_LOGIN_ENABLED、WORKBENCH_PUBLIC_ORIGIN、PILOT_LOG_IDENTITY_HASH_KEY、WORKBENCH_EXTERNAL_SEND_ENABLED |
| 通道 | WECOM_BOT_ID、WECOM_BOT_SECRET、WECOM_WS_URL、P2_G1_GATEWAY_ENABLED、P2_G1_SENDER_ENABLED、P2_G1_ALLOWED_TARGET_HASHES |
| 群webhook | P2_G2_GROUP_WEBHOOK_ROUTES（私有ID/秘密URL不得展示） |
| 人员目录 | THIRD_STAFF_DIRECTORY_ENABLED、THIRD_STAFF_DIRECTORY_ROOT_ID、THIRD_STAFF_INFO_SYNC_KEY、THIRD_STAFF_DIRECTORY_BASE_URL |

核对：[成员OAuth测试](../../../tests/p2-g2-wecom-web-oauth.test.mjs)、[成员目录测试](../../../tests/p2-g2-member-directory.test.mjs)、[员工认证测试](../../../tests/p2-016-workbench-wecom-auth.test.mjs)。[企业微信集成总说明](../../07_wecom_websocket_integration.md)。当前src/scripts没有业务AI/LLM/Jev HTTP client；研究文件及网络阻止探针不能列为已实现模型接口。

## 原来源单人成员App通知（WBINT-T25，默认关闭）

后端实际App Sender先取现有token Provider，调用 `POST https://qyapi.weixin.qq.com/cgi-bin/batch/userid_to_openuserid`，再 `POST https://qyapi.weixin.qq.com/cgi-bin/message/send`；conversion只接受精确一个核实pair，agentid等于原sourceAppScope。单PERSON template_card沿批准安全字段和本人详情URL；浏览器没有直接SDK接口。credential/fetch/body-read/cancel共享5秒截止，响应≤8KiB。完整可信技术ACK要求errcode=0及非空可核验msgid；发送后的非零/不完整/UNKNOWN都显式核对原Delivery，不猜官方去重或未应用保证。当前主站正文未获得，字段/命名空间/错误副作用保证UNCONFIRMED；实际SDK-only ACK与合成人工核对不表示客户端送达。详见[应用通知及停止线](../workbench/app-notifications.md)。
