# 管理端来源群名称

日期：2026-10-07。状态：本地实现，新宿主选项 `sourceGroupDirectoryEnabled` 默认 false；真实库迁移、启用和部署尚未执行。名称由管理员确认，不冒充企业微信自动返回的群名。

返回 [接口导航](../README.md) · [看板](board.md) · [群回调实测](../integrations/wecom-message-callback.md)。决策：[ADR-0030](../../../adr/0030_admin_confirmed_source_group_names.md)。

## 统一来源读取

| METHOD + PATH | 变化与权限 |
| --- | --- |
| `GET /api/workbench/board` | items[]增加source_label、source_group；沿现有获权范围查询 |
| `GET /api/workbench/items/{kind}/{id}` | item采用相同DTO，卡片、列表、详情一致 |
| `GET /api/lifecycle/bootstrap` | source_group_directory_enabled:boolean，沿现有认证；csrf_token供Cookie写请求使用 |

旧 `/api/tickets/{ticketId}` 生命周期DTO不包含本模块的展示字段。前端不调用企业微信，也不逐工单请求群名。

| 字段 | 类型与语义 |
| --- | --- |
| source | 来源类别；开启模块时从有效原始Intake/Journey解析 |
| source_label | string，后端统一生成显示文案 |
| source_group | GroupDisplay或null；关闭模块、非群、无有效来源群时null |
| source_group.ref | 64位小写十六进制不透明引用；provider、Bot ID、chatid规范JSON数组的SHA-256；不是原始ID |
| source_group.display_name | string或null，当前管理员登记名称 |
| source_group.name_source | ADMIN_CONFIRMED或UNREGISTERED |
| source_group.row_version | 十进制string；未登记为"0"，与Ticket版本独立 |

合成示例（其他卡片字段省略）：

```json
{
  "source": "WECOM_GROUP",
  "source_label": "群聊报修 · 信息科支持群",
  "source_group": {
    "ref": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "display_name": "信息科支持群",
    "name_source": "ADMIN_CONFIRMED",
    "row_version": "1"
  }
}
```

未登记显示“群聊报修 · 群名称未登记”；私聊显示“Bot 私聊”，医小修显示“医小修”。开启时原始来源冲突或超过保留期显示“来源资料不可用”。关闭时不查询037的新表，保留既有读取范围，群来源明确提示未登记。

群转单聊、后续H5访问和转派不改来源群。有Journey时沿事项自身source Intake的origin/leg绑定取有效origin_intake_id，不把其他已关联该Ticket的受理来源当成工单原始来源，不从最后一条消息或当前Conversation猜来源；多个冲突来源或过期Journey不能回落后续leg。改名更新当前显示资料，不修改Ticket、Intake、Journey和通知路由，不补造历史群名快照。

## 管理员目录

`GET /api/workbench/source-groups?limit=50&cursor=...`

宿主W，沿现有内部认证链。必须是当前有效ADMIN；普通坐席不能读取全局目录。仅查询有效Intake中已观察群。limit默认50，范围1..100；cursor服务端生成并绑定principal，ref升序keyset分页。仅接受cursor/limit，重复或未知参数拒绝。

```json
{
  "items": [{"ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","display_name":null,"name_source":"UNREGISTERED","row_version":"0"}],
  "next_cursor": null
}
```

不返回原始Bot ID/chatid、报修正文。不同Bot/群分开登记，同名不会合并。管理员也可从已核对的事项详情取得group.ref并登记。

## 管理员登记或改名

`POST /api/workbench/source-groups/{groupRef}/name`

groupRef必须是当前有效的已观察群引用。每次（包括重放）重查ADMIN授权和来源留存。禁止query参数或客户端注入外部群ID。

必要头：Content-Type application/json；Idempotency-Key与body.client_command_id一致；If-Match严格为带双引号的资料版本，首次为 `"0"`。Cookie认证要求同源Origin及X-CSRF-Token，跨站拒绝；受控Bearer沿宿主认证。请求体上限32KiB。

```json
{
  "client_command_id": "b5533980-45b3-49d5-9843-5c9ddcda132a",
  "expected_row_version": "0",
  "display_name": "信息科支持群"
}
```

只接受上述三个字段。名称trim后1..128个Unicode字符，不含ASCII控制字符。版本为规范十进制string且小于9223372036854775807。机器合同：[命令Schema](../../../contracts/workbench_source_group_name_command.schema.json)、[共享DTO](../../../contracts/web01_workbench_contracts.d.ts)。

成功200：

```json
{
  "ok": true,
  "group": {"ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","display_name":"信息科支持群","name_source":"ADMIN_CONFIRMED","row_version":"1"},
  "replayed": false
}
```

名称、版本、追加变更记录及成功回执同事务提交。同一管理员+command ID+规范化payload重放原成功，replayed=true；同一命令更改payload、版本过时或并发修改为409。失败回滚全部写入；源过期或权限撤销后拒绝重放。新名称使用新命令，网络结果未知时前端保留原命令重试。

| HTTP | 错误码 / 场景 |
| --- | --- |
| 400 | P2_016_INPUT_INVALID / P2_016_LIMIT_INVALID / P2_016_CURSOR_INVALID；宿主WORKBENCH_IDEMPOTENCY_MISMATCH用于头/body不一致，WORKBENCH_REQUEST_INVALID用于非法JSON |
| 401 | WORKBENCH_UNAUTHENTICATED / WORKBENCH_AUTH_EXPIRED |
| 403 | P2_016_FORBIDDEN；WORKBENCH_ORIGIN_INVALID / WORKBENCH_CSRF_INVALID |
| 404 | P2_016_NOT_FOUND；未观察、过期或不支持路径 |
| 409 | P2_016_VERSION_CONFLICT / P2_016_COMMAND_CONFLICT |
| 413 / 415 | WORKBENCH_REQUEST_TOO_LARGE / WORKBENCH_CONTENT_TYPE_INVALID |
| 503 | P2_016_DISABLED；新模块关闭 |

错误沿宿主 `{error:{code,...}}`，不含外部ID；见[共用约定](../conventions.md)。

## 管理端使用

从 `/workbench/app/` 看板/列表打开群来源事项详情。模块开启且当前bootstrap身份是ADMIN时显示“来源群名称”表单。保存后失效并重读当前身份board/detail缓存，三处一致；普通坐席只读获权事项的来源标签。名称以React文本渲染，不解析HTML。后端每次写请求重查角色，前端按钮不构成授权。

## 存储、安装和关闭

独立迁移[037](../../../database/migrations/037_workbench_source_group_names.sql)创建workbench.source_group_name、source_group_name_change、source_group_name_receipt。只存群引用、名称、版本和操作者，不复制外部ID或Ticket事实。沿宿主池复用，无新增常驻进程或池；迁移器max=1。

获授权目标库已具备031及现有基线后，通过独立入口执行：

```powershell
node .build/runtime/scripts/workbench-source-groups-migrate.mjs --check
node .build/runtime/scripts/workbench-source-groups-migrate.mjs --apply
```

入口读取PILOT_DATABASE_URL，默认check不应用。迁移记校验和，重复apply返回NOOP_ALREADY_APPLIED。不加入固定历史迁移清单。宿主须显式传 `createP2016Runtime({...existingOptions,sourceGroupDirectoryEnabled:true})`；没有自动读取新增环境开关。关闭时省略/传false并重启，bootstrap返回false、维护接口503；保留名称和审计表即可，不删除历史资料。启用时健康检查要求037迁移标记。发布、真实库迁移和现场验证沿既有授权边界。

## 实现和验证

[后端模块](../../../src/workbench-source-groups.mts)、[HTTP](../../../src/web01-workbench-http.mts)、[读取查询](../../../src/web01-workbench-query.mts)、[运行装配](../../../src/p2-016-runtime.mts)、[客户端](../../../web/admin-workbench/src/api/client.ts)、[界面](../../../web/admin-workbench/src/app/App.tsx)、[迁移器](../../../scripts/workbench-source-groups-migrate.mts)。

验证覆盖名称与大整数版本、隔离PG/HTTP登记改名、不同Bot/群不串名、幂等/并发、ADMIN及CSRF/Origin、原始群不随单聊改变、过期降级、外部ID不泄露、零外发、正式bundle表单及三处显示。结果见[本轮本地记录](../../../evidence/workbench-source-group-names-local.md)。
