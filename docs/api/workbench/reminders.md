# 站内提醒与本浏览器偏好（WBINT-T40）

本票提供默认关闭的只读提醒投影及正式工作台界面。当前本地隔离验证与父验收状态见 [T40 执行记录](../../../plans/admin-workbench-integration/execution/t40.md)。冻结的 [设计及原始准备记录](reminders-design.md) 保留其当时的 NOT_RUN 状态；该历史文字不代替本次运行证据。接口已实现不表示部署或真实外部发送已获批准。

## 入口和当前权限

W 宿主新增 `GET /api/workbench/reminders`，复用原 Cookie／当前工作人员认证。运行时 `workbenchRemindersEnabled=false`；bootstrap 返回 `workbench_reminders_enabled:false`、`reminders_endpoint:null`。明确启用后 endpoint 为 `/api/workbench/reminders`，前端仍要求原实时能力及当前 LIVE 状态。

每次读取先按原 canonical Card 的 READ 裁剪，再核验团队或个人关系。负责人、看过、收到提醒、URL 中的 ID 或基线 token 都不授予 READ／写权。个人相关条件沿原处理责任、有效沟通责任、本人明确 Follow 并集；读写和阅读位置仍由原接口独立管理。

| reason | 原事实及边界 |
| --- | --- |
| `AUTHORIZED_TEAM_NEW_REPORT` | 原 Intake 的初次报修，当前获权团队可读；同源 Review 转 Ticket 不重复算新报修。Bot 初次材料绑定同 Intake／Session／原 primary Channel Message 的真实 `conversation.item.created`；原代录及复核发布器的事件沿既有合同匹配。 |
| `RELATED_NEW_MATERIAL` | 原保留的 Channel Message／Web Supplement 及修订；后续 Contact Journey Leg 的真实 PRIMARY 材料也可属于同一 Ticket。 |
| `RELATED_REOPEN` | 原 Ticket 重开事件及当前轮次；要求当前 READ 和个人相关关系。 |
| `RELATED_FOLLOW_UP_DUE` | T37 原 Ticket、schedule_version 和一次到期信号；同事务原实时事件引用，不创建第二份到期事实。 |

内部备注、Delivery 变化、普通刷新和已读变化不构成提醒事件。返回前在原池、只读 READ COMMITTED 事务中处理实际表锁等待后的当前主体／团队／角色及官方 Session 复核；材料和事件保留期使用真实物理时钟。失效范围只返回新空基线，技术失败不被解释为失权。

## Query 与响应

六个闭合 Schema 和 DTS 沿 `contracts/workbench_reminder_*` 原件；无新数据库结构、迁移或业务写接口。

| 参数 | 合同 |
| --- | --- |
| `after_event_id` | 可空十进制字符串，最大 `9223372036854775807`，不转 JS Number。 |
| `baseline_token` | 可空、最多512字符；进程私有 HMAC，绑定当前权限、事实时间和事件水位。 |
| `cursor` | 可空、最多512字符；绑定原基线、窗口、水位、limit及排序。 |
| `limit` | 默认50、范围1–50；未知或重复参数400。 |

初始无窗口读返回 `items:[]`，以及 `schema_version:1`、当前 `as_of_event_id`、`baseline_token`、`next_cursor:null`、`reset_required:false`。增量每页最多50项，item只包含 `reminder_id`、`event_id`、`reason`、`canonical_item`、`source_key`、`source_revision`、`occurred_at`。摘要稳定绑定原来源和修订；不含正文、内部记录、人员／群／投递目标或凭据。时间沿 Asia/Shanghai 无 offset 秒精度合同。

伪造、过期、过旧或范围不符的窗口返回200与空项／`reset_required:true`，不能用任意水位读取历史。原始新旧事实仍以精确来源时间和事件窗口判定：同秒 Bot／代录只使用原服务端生成路径的 UUIDv7 精度，Web 使用原 received_epoch_ms；无法证明晚于基线的同毫秒不放行。到期信号沿原同事务 event_id。晚投影不把基线前的事实变成新提醒。

未登录401，当前授权拒绝沿原403／404语义，总开关关闭503；非 GET 无写入口。提醒503或慢响应仅提示“提醒暂未更新”，不把健康业务 REST／人工命令降为不可用。

## 定位、声音和个人设置

提醒可显式移除或定位，不自动打开／提交／推进个人阅读位置或处置。定位先读原 `/api/workbench/items/:kind/:id`；已加载卡片直接标记，跨页目标复用原 `/workbench/app/items/:kind/:id?locate=1` 规范卡片。无需扫描列表；列表缺项不等于无权。临时技术失败保留同一 URL 目标供重试，真实失权清敏感。进入详情仍须用户另点原详情链接。

每个新页面声音和桌面均需当前用户主动开启，试听使用用户点击。唯一持久偏好键 `wbint-reminder-preferences-v1` 只接受最多128字节的闭合 JSON：`schema_version:1`、布尔 `sound_enabled` 和 `desktop_enabled`。不保存主体、凭据、草稿或提醒队列。账号／权限切换清旧提醒、旧自动资格和本功能偏好；新页面不由旧保存值自动启动播放或申请权限。

同源 exclusive Web Lock 只允许一个自动提醒领导者；其余文档有界排队，原领导者离开后接替者先重建基线。BroadcastChannel仅传当前临时权限摘要和 reminder摘要。750ms内的簇最多一次120ms短音，自动音间隔至少2秒；相同来源修订跨标签去重。隐藏、离线、重连、换账号和恢复不补响历史。拒播／未启用不影响视觉提醒。

桌面通知只在本页面用户主动选择且浏览器权限允许时产生，内容为通用提示、tag为不透明摘要，不附自动导航。关闭、失权、隐藏和卸载清理本功能通知。浏览器 API 的实际调用、受控拒播和 CDP 权限输入验证，不证明实体扬声器或 Windows 通知中心实际送达。

## 资源、关闭与证据

复用 T38 一个 SSE／原刷新时钟，不新增轮询器、Worker、连接池、消息平台或持久表。一次刷新最多4页／200候选；不完整时重建基线。视觉最多40项／10分钟，内存去重最多256项／10分钟。每文档最多一个 AudioContext、BroadcastChannel、锁请求和短簇 timer；原 AbortSignal／授权 generation 阻止旧响应和定时器污染新范围。沿单 App／Worker、Gateway 单活、SSE32及池预算。

总开关设为 false 关闭新 GET能力和界面；声音可单独静音。关闭不删除 Ticket、事件、Follow、阅读位置、共享跟进、旧证据或其他设置。原 first、合同、SQL及历史失败保持原件；当前执行记录列出真实被测提交、MF、具体用例与清理证据。无部署、真实外发、full／certify或 Gate 推进。
