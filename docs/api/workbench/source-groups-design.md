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

`GET /api/workbench/source-groups?limit=50&q=...&cursor=...`

宿主W，沿现有内部认证链。必须是当前有效ADMIN；普通坐席不能读取全局目录。仅查询有效Intake中已观察群。limit默认50，范围1..100；可选q为trim后的0..128个Unicode字符，拒绝ASCII控制字符；空值查询全部，非空值对当前登记名称作不区分大小写的字面子串搜索，也可搜索不透明ref的子串。百分号和下划线没有通配含义。先验权、再搜索、再分页，不在浏览器过滤已加载页。cursor服务端生成并绑定principal及规范化q，ref升序keyset分页；更换搜索须从第一页重新读取。仅接受cursor/limit/q，重复或未知参数拒绝。T23增量无新Schema或数据库迁移，沿既有SourceGroupPage与037。

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

T23设置页为 `/workbench/app/settings/source-groups`，沿同一W认证和正式静态制品；宿主只新增该精确SPA路径。管理员且模块开启时从设置进入有界目录，每页50项，可检索当前名称或不透明引用并前后翻页；页码／本页数量不冒充总数，最多显示本页50行及一个名称表单。关闭或普通身份直接打开时明确不可维护，不读取新目录。来源群检索不属于工单全局搜索，不增加第三方目录、上传或AI能力。

从 `/workbench/app/` 看板/列表打开群来源事项详情，或从设置定位目录行。模块开启且当前bootstrap身份是ADMIN时显示同一个“来源群名称”表单。ref为行和表单身份，同名行分别维护；名称以React文本渲染，不解析HTML。普通坐席只读获权事项的来源标签，后端每次写请求重查角色和来源留存，前端按钮不构成授权。

表单进入时固定精确string编辑版本；目录或详情后台重读仅提示更新，不自动改编辑依据或覆盖输入。409保留名称并停止保存，需要用户明确“重新读取并采用最新版本”后再次确认保存；该操作只读取当前资料，保留输入，不自动POST。新保存用新UUID及被明确采用的版本。200回执须含相同ref、规范名称、精确expected+1版本和replayed；网络异常、不可信200或不确定5xx为UNKNOWN，锁定输入和原命令，只有“核对保存结果”按原UUID／原payload／原If-Match重放。未改动的名称不重复提交。

提交／核对／读取采用各有单一自有AbortController，卸载取消；abort不证明原POST未提交。未知结果或请求进行中，目录检索、换页／换群及详情关闭受阻。可信401／403／404即使错误正文不可信仍触发身份／目录授权清理，取消相关查询、清同身份全部目录页与名称mutation缓存、重读bootstrap和获权事项。成功失效并重读当前身份board／detail／directory，三处名称一致；这些缓存不是事实源。原命令和输入仅在组件内存，不引入持久草稿或Zustand业务资料。关闭模块保留已提交名称、版本、审计和原业务事实。

## 存储、安装和关闭

独立迁移[037](../../../database/migrations/037_workbench_source_group_names.sql)创建workbench.source_group_name、source_group_name_change、source_group_name_receipt。只存群引用、名称、版本和操作者，不复制外部ID或Ticket事实。沿宿主池复用，无新增常驻进程或池；迁移器max=1。

获授权目标库已具备031及现有基线后，通过独立入口执行：

```powershell
node .build/runtime/scripts/workbench-source-groups-migrate.mjs --check
node .build/runtime/scripts/workbench-source-groups-migrate.mjs --apply
```

入口读取PILOT_DATABASE_URL，默认check不应用。迁移记校验和，重复apply返回NOOP_ALREADY_APPLIED。不加入固定历史迁移清单。宿主须显式传 `createP2016Runtime({...existingOptions,sourceGroupDirectoryEnabled:true})`；没有自动读取新增环境开关。关闭时省略/传false并重启，bootstrap返回false、维护接口503；保留名称和审计表即可，不删除历史资料。启用时健康检查要求037迁移标记。发布、真实库迁移和现场验证沿既有授权边界。

## 实现和验证

[后端模块](../../../src/workbench-source-groups.mts)、[HTTP](../../../src/web01-workbench-http.mts)、[读取查询](../../../src/web01-workbench-query.mts)、[运行装配](../../../src/p2-016-runtime.mts)、[客户端](../../../web/admin-workbench/src/api/client.ts)、[目录](../../../web/admin-workbench/src/features/source-groups/SourceGroupDirectory.tsx)、[共用名称表单](../../../web/admin-workbench/src/features/source-groups/GroupNameEditor.tsx)、[迁移器](../../../scripts/workbench-source-groups-migrate.mts)。

既有核心验证记录保持[原本地证据](../../../evidence/workbench-source-group-names-local.md)的原对象和状态。T23的当前检索／设置／可靠表单、同名Ref、版本依据、撤权及关闭的实际候选、报告和清理见[本票执行记录](../../../plans/admin-workbench-integration/execution/t23.md)；不由旧结果推导本票通过或已发布。
