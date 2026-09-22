# G0-005 补充：代开发应用 HTTP 模板卡片主动推送

- 验证日期：2026-09-22。
- 验证范围：仅验证企业微信代开发应用的 HTTP 应用消息接口和成员读取接口；不把该结果计入 Bot WebSocket `aibot_send_msg` 或 G0-006 的卡片回调结论。
- 业务范围：不创建工单、不写 Pilot Ticket Core、不启动 P2-G2-LIVE。
- 隐私边界：不保存 token、Secret、原始 Bot userid、转换后的完整 open_userid、手机号、头像 URL、原始 msgid 或个人信息。

## 官方接口依据

- [开发前必读](https://developer.work.weixin.qq.com/document/path/97159)：代开发应用授权应用使用授权企业 access_token 调用通讯录、应用和消息接口。
- [获取企业凭证](https://developer.work.weixin.qq.com/document/path/90605)：服务商正式链路使用 `service/get_corp_token`，提交 `suite_access_token`、`auth_corpid` 和 `permanent_code` 获取授权企业 access_token。
- [发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)：应用消息统一使用 `POST /cgi-bin/message/send?access_token=ACCESS_TOKEN`。
- [读取成员](https://developer.work.weixin.qq.com/document/path/96255)：成员详情使用 `GET /cgi-bin/user/get?access_token=ACCESS_TOKEN&userid=USERID`；代开发应用的敏感字段受管理员授权和成员 OAuth2 授权约束。
- 本次抓取摘要：[`.firecrawl/wecom-yxx-api-validation-20260922.md`](../.firecrawl/wecom-yxx-api-validation-20260922.md)。

## 可复用接口方法

### 1. 获取授权企业 access_token

正式服务商链路：

```text
suite_access_token
  + auth_corpid
  + permanent_code
  → POST /cgi-bin/service/get_corp_token
  → access_token, expires_in
```

`access_token` 只保存在服务端的应用级缓存中，不能返回前端、写入日志或证据。当前 `.env.pilot` 没有 `suite_access_token/permanent_code`，本次实际验证使用的是既有 `CORP_ID + APP_SECRET` 应用令牌路径；因此本记录不声称完整的服务商永久授权码链路已通过。

当前应用凭据路径的接口形状是：

```text
GET /cgi-bin/gettoken?corpid=CORP_ID&corpsecret=APP_SECRET
```

只有在凭据确实属于该企业应用时才可使用；它不能替代正式代开发应用的 `service/get_corp_token` 链路。

### 2. 解决成员命名空间

Bot 侧的企业明文 userid 不能直接当作代开发应用接口的成员 ID。需要先调用官方转换接口：

```text
POST /cgi-bin/batch/userid_to_openuserid?access_token=ACCESS_TOKEN
body: { "userid_list": ["BOT_USER_ID"] }
→ open_userid_list[].open_userid
```

本次转换返回 `errcode=0` 且没有无效成员；后续 `user/get` 和 `message/send` 均使用转换后的 `OPEN_USERID`。原始 ID 与完整转换结果未写入证据。

### 3. 推送文本通知型模板卡片

```http
POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=ACCESS_TOKEN
Content-Type: application/json
```

最小可复用请求形状：

```json
{
  "touser": "OPEN_USERID",
  "msgtype": "template_card",
  "agentid": 123,
  "template_card": {
    "card_type": "text_notice",
    "source": { "desc": "医小修", "desc_color": 1 },
    "main_title": { "title": "标题", "desc": "辅助说明" },
    "sub_title_text": "通知正文",
    "horizontal_content_list": [
      { "keyname": "项目", "value": "值" }
    ],
    "card_action": { "type": 1, "url": "https://work.weixin.qq.com" },
    "task_id": "unique-task-id"
  },
  "enable_id_trans": 0,
  "enable_duplicate_check": 1,
  "duplicate_check_interval": 1800
}
```

约束：

- `touser` 只放经过命名空间转换并在应用可见范围内的目标；本次验证禁止使用 `@all`、部门或标签广播。
- `msgtype` 固定为 `template_card`；本次采用 `card_type=text_notice`。
- `text_notice` 必须提供 `card_action`；如使用 `action_menu`，`task_id` 必填且同一应用内不可重复。
- `card_action` 只能指向经过批准的 HTTPS URL；禁止把 token、userid、OAuth code 或状态凭据放入 URL。
- `enable_duplicate_check=1` 和固定时间窗只能减少同内容重复，不替代项目侧 Outbox/Delivery 幂等和 UNKNOWN 对账。
- 官方页面给出的频率边界为：每应用每日不超过企业账号上限的 200 倍人次；同一成员不超过 30 次/分钟、1000 次/小时。

### 4. 读取成员信息

```http
GET https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=ACCESS_TOKEN&userid=OPEN_USERID
```

重点字段：`userid`、`name`、`department`、`gender`、`mobile`、`avatar`。其中姓名、部门查看范围以及性别、手机号、头像等敏感字段必须按企业管理员授权和成员 OAuth2 授权结果解释，空字段不能推断为“用户没有该信息”。

## 本次定向验证结果

| 场景 | Provider 结果 | 客户端/字段结论 | 状态 |
|---|---|---|---|
| 应用令牌获取 | `errcode=0` | 令牌未写入证据 | 通过（当前应用令牌路径） |
| Bot userid 转 open_userid | `errcode=0`，无效列表为 0 | 完整 ID 未写入证据 | 通过 |
| `user/get` | `errcode=0` | `userid` 有值；`name`、`department`、`gender`、`mobile`、`avatar` 未返回 | 部分通过 |
| `message/send` 模板卡片 | `errcode=0`，返回 msgid；仅 1 次调用 | 未进行人工客户端展示确认 | Provider ACK 通过；客户端验收未运行 |

`errcode=0` 只证明企业微信接受请求，不证明客户端显示、通知或用户点击。后续若要把本能力标为客户端通过，必须新增脱敏的人工观察证据；若要取得完整成员字段，必须先完成管理员敏感字段授权和测试用户 A 的 OAuth2 `snsapi_privateinfo` 授权。

## 关闭与回退

- 本能力不打开持久 Feature Flag，不改变现有 Bot WebSocket Sender、Outbox 或模板卡片运行时。
- 发生超时、断线或无响应时记录 `UNKNOWN`，不得盲目重发；有 `errcode=0` 后不得由同一 Delivery 直接重发。
- `invaliduser`、`unlicenseduser` 或全目标无效时按目标/权限错误处理；先修复命名空间、可见范围或授权，再创建新的受控发送意图。

## 同日后续：从 Bot 回调 userid 读取用户资料

上一节“本次定向验证结果”保留的是前一次读取成员运行的原始结论；本节是随后针对用户 A 的脱敏复核，不覆盖前一条记录。

- 通过上一轮 Bot 群聊/单聊帧的 `sender_user_id_hash` 与配置测试用户做哈希比对，确认测试对象一致。
- 先调用 `batch/userid_to_openuserid`，得到 `errcode=0`、1 个成功映射、0 个无效成员；未把任一原始或转换后的 ID 写入证据。
- 再调用 `user/get`，得到 `errcode=0`。本次观察到 `userid`、`name`、一个部门 ID、`alias` 和激活状态；`position` 为空，`mobile`、`gender`、`email`、`avatar`、`telephone`、`address`、`qr_code` 等未返回。
- 随后对该部门 ID 调用 `department/get`，得到 `errcode=0` 且部门名称字段存在；部门 ID 与部门名称都不进入本证据。

本次结论为 `PROFILE_LOOKUP_PARTIAL_PASS`：通过 Bot userid 做命名空间转换后，可以读取当前应用可见范围内的非敏感成员资料和部门名称；不能据此声称敏感个人字段已授权，也不能把 Bot 回调本身说成携带完整用户资料。
