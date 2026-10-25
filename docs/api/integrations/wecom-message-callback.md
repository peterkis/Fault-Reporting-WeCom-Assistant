# 企业微信群聊 @Bot 消息回调与来源识别

返回 [接口导航](../README.md) · [外部服务](external-services.md) · [HTTP索引](../endpoint-index.md)

## 本次最小现场验证

2026-10-07 18:09:06（Asia/Shanghai），本机 `.env` 测试Bot通过SDK认证后，收到用户在测试群内 @Bot 发送的一条真实文本回调。群ID已收到，群名称未收到。

| 检查项 | 实际结果 |
| --- | --- |
| 回调命令 | `aibot_msg_callback` |
| 消息类型 | `body.msgtype = "text"` |
| 会话类型 | `body.chattype = "group"` |
| 群ID | `body.chatid`为非空string，存在 |
| 群名称 | body及嵌套字段均未观察到群名称；chatname/chat_name/groupname/group_name不存在 |
| 完整body字段 | aibotid、chatid、chattype、from、msgid、msgtype、response_url、text |
| 嵌套字段 | from.userid、text.content；无群名称子字段 |
| 停止与副作用 | 捕获1条后disconnect并退出；回复0、业务数据库连接0 |

群名称缺失发生在进入业务适配器之前。结论范围是本次测试Bot/群及当前回调，不能升级为“企业微信所有群资料API都不存在”。

## 实际服务入口

| 项目 | 契约 |
| --- | --- |
| Endpoint | `wss://openws.work.weixin.qq.com`；私有部署以批准的WECOM_WS_URL为准 |
| 方向 / Frame | 企业微信→Gateway；`cmd = aibot_msg_callback` |
| SDK事件 | 所有消息message；普通文本message.text；图文message.mixed |
| 认证 | SDK长连接使用Bot ID/Secret订阅，凭据不发给前端 |
| 群识别 | body.chattype为group，读取body.chatid |
| 本项目字段 | message.chat_type=group，message.chat_id=body.chatid |
| 群名称 | 当前回调未提供；标准化Message没有chat_name |
| 本项目HTTP映射 | 没有独立HTTP回调/获取Bot群名称REST入口；早期设计路径/internal/v1/intakes/wecom未挂载 |

最小读取方式（接入现有Gateway连接，勿另建第二个活动连接）：

```javascript
wsClient.on('message.text', (frame) => {
  if (frame.body?.chattype !== 'group') return;
  const groupId = frame.body.chatid;
  // groupId用于受保护的通道上下文，不输出到公开日志或浏览器。
});
```

合成Frame，仅说明字段形状：

```json
{"cmd":"aibot_msg_callback","headers":{"req_id":"synthetic-req"},"body":{"aibotid":"synthetic-bot","chatid":"synthetic-group","chattype":"group","from":{"userid":"synthetic-user"},"msgid":"synthetic-msg","msgtype":"text","response_url":"https://example.invalid/reply","text":{"content":"群信息验证"}}}
```

实现：[Gateway](../../../app/server/src/p2-g1-wecom-gateway.mts)、[adaptWeComSdkFrame](../../../app/server/src/p1-002-wecom-sdk-adapter.mts)、[标准化Schema](../../../contracts/normalized_wecom_message.schema.json)。官方SDK的[消息结构与命令协议](https://github.com/WecomTeam/aibot-node-sdk)定义chatid，未定义群名称字段。

## 如何知道消息来自哪个群

技术上的群来源由chatid标识。当前Adapter已将它保存到标准化message.chat_id，Intake沿用source_chat_id；不用群名称作为路由、聚合或身份键。

管理端的群名维护方式已由用户确认，并作为后继增量实现：[来源群名称接口](../workbench/source-groups-design.md)。管理员从已核对的来源事项登记群名，按 `(provider, bot_id, chat_id)` 的不透明引用关联；未登记明确显示“群名称未登记”，不能根据正文或发送者猜名称。群名是可修改显示资料，chatid是来源标识。上述只读回调验证本身没有业务库写入；后继名称模块有独立037迁移，默认关闭。

### 官方资料查询及边界

用户指定Firecrawl查询。2026-10-07，Firecrawl官方回调页抓取与两次官方域搜索均返回额度不足/HTTP402，未取得页面正文。Browser连接也未能建立；企业微信文档站的具体页面通过普通读取仍不可访问。因此以下结论来自已成功读取的官方SDK和腾讯官方API导航；不声称已通过Firecrawl完整遍历官方站点。

| 来源 / 能力 | 本次确认内容 | 对Bot群名称查询的含义 |
| --- | --- | --- |
| [WecomTeam官方SDK](https://github.com/WecomTeam/aibot-node-sdk) | 回调BaseMessage有chatid/chattype，没有群名称字段；公开SDK方法未列出Bot群名称查询 | 可以标识群来源；没有证明自动取得群名 |
| [腾讯官方API导航](https://cloud.tencent.com/document/product/1301/88712)中的应用群聊会话 | appchat_get只允许企业自建应用调用，应用可见范围须为根部门 | 不能只因为参数也叫群ID，就假定Bot的chatid可在该接口查询；本次未验证ID兼容性 |
| 同页的客户群详情 | externalcontact_groupchat_get用于具有客户群使用权限的成员创建的外部客户群，可返回群名 | 不是任意Bot内部群的通用查询入口；本次没有证明客户群ID与Bot chatid可互换 |

待可直接读取的企业微信原始页面：[消息推送回调](https://developer.work.weixin.qq.com/document/path/101463)、[获取应用群聊会话](https://developer.work.weixin.qq.com/document/path/90247)、[客户群详情](https://developer.work.weixin.qq.com/document/path/92122)。截至本次查询，**未找到已验证的、能把本次普通Bot群chatid直接换成群名称的官方接口或转换合同**。这是当前证据范围，不是穷尽性“不存在”结论；不得据此虚构GET /api/groups/{id}/name。

## 最小验证回执

用户确认本机 `.env` 测试Bot无其他活动长连接，授权只捕获群消息。SDK1.0.6；自动重连关闭，每个窗口最多180秒，最终收到1条group/text回调后停止。原始群ID、群名称、消息原文、用户ID、response_url和凭据均未保存；回执仅含字段名/类型、存在性和哈希。

前两个窗口分别在测试标记调整和取消内容筛选时中止，未产生成功回执；不推定其间消息已经到达监听器。最终取消内容筛选，监听所有消息类型，只选择group回调，成功收到1条text。中止窗口不记作通过，不用“无匹配记录”推断字段不存在。

独立脱敏回执：[wecom-group-callback-metadata-20261007-180906.json](../../../evidence/wecom-group-callback-metadata-20261007-180906.json)。SHA-256：`49dc65fea7f4396d22417b8c854b3abd72490277c42a6ba09623d9f3e7a5c1f7`。UTC观察时间：`2026-10-07T10:09:06.725Z`。捕获进程已退出、测试连接已关闭，停止记录显示1条消息/1条群回调、回复0、业务数据库连接0。

本地最小核验另外通过：4条历史真实群回调均有chatid且无群名称字段；当前Adapter编译产物source map与源码一致，合成group Frame正确映射chat_id；脱敏捕获不保存原群ID/原文。[原历史回执](../../../evidence/g0-003-frame-captures.jsonl)保持不变，本地形状/转换核验与本次现场分别记账。

无源码、数据库、默认Feature Flag或业务Gate变更；业务回归/full/certify未运行。新回执是独立接口观察，不是readiness或生产批准；原G0/SS009证据未改写。
