# PC 员工媒体读取

[ADR-0050](../../../adr/0050_pc_media_employee_read_and_server_previews.md)；`workbenchMediaEmployeeReadEnabled=false` 为默认值。使用 W 的既有员工认证宿主，不是匿名文件服务。此开关须由 human-v1 JSON 显式设置，同时传给 APP/WORKER；Gateway 不接收。Web 优化依赖原 H5 私有存储、066及070；Worker仍需受信 FFmpeg/FFprobe。生产配置启动前核验依赖。

## 请求与权限

| 方法 | 路径 | 参数与行为 |
| --- | --- | --- |
| GET | `/api/workbench/media/web/{ref}` | 可选单一 `variant=ORIGINAL|PLAYABLE|THUMBNAIL`，默认 PLAYABLE；支持单 Range |
| HEAD | `/api/workbench/media/web/{ref}` | 同上，只读元数据，不打开或解密文件 |
| GET | `/api/workbench/media/attachment/{ref}` | 受信登记 PNG/JPEG 原件，可省略 variant 或使用 ORIGINAL；不支持 Range |

ref 为不透明 UUID；不接收 Ticket ID、Intake ID、文件路径或令牌。有效员工会话、活动账户及 ADMIN/DISPATCHER/HANDLER 角色由本次宿主认证核验。持有UUID的有效员工可以读取其他团队工单的媒体，不再联查工单/团队读取权或原始来源关联。事项、详情与媒体发现列表保留原权限；不提供独立媒体列表。

Web 初始查询仅选择 BOUND、未清理且媒体自身 `expires_epoch_ms` 有效的记录；草稿不可读。旧附件初次打开以可信登记的分类、扫描状态、大小、MIME与自身期限判定，原 PATIENT_SENSITIVE/SECRET 等限制保持。已开始传输不因中途撤权、到期、关系变化继续查库；后续 HTTP（包括新 Range）重新认证和检查到期。

Web 每 HTTP 在认证宿主之外恰一次媒体记录查询；正文输出后零媒体/权限SQL。不把宿主的认证SELECT与last_seen维护UPDATE省略于实际计数。HEAD不证明物理文件可用；实际缺失或损坏在GET时报告。

## 响应与资源

响应 `Cache-Control:no-store`、`nosniff`、`no-referrer`；原件attachment，Web播放/缩略图inline。200有精确Content-Length，单Range返回206与Content-Range；不可满足416附`bytes */size`，多区间及携带If-Range沿既有H5规则退回完整200。HEAD返回完整表示长度，无正文。旧登记图片HEAD为405、Range为416。

新入口关闭404；无会话401；Web不存在、未绑定、清理或到期统一`YXX_MEDIA_NOT_FOUND`404；缺失/未就绪副本为原媒体错误。旧附件保留`ATTACHMENT_EXPIRED`410、`ATTACHMENT_MISSING`404、分类/完整性422。存储不可用503、过载429、超时504；已发响应头后发生错误销毁输出，不拼接JSON。

实际GET仍先完成整个对象的GCM/AAD/SHA认证，再输出完整或指定区间。保持文件根目录保护、64KiB分块、背压、断开取消、句柄/明文释放。Web原预算为磁盘1、读取lease2、明文及输出预留32MiB、等待8、含排队60秒；旧登记Store仍单读取与15秒。每个Range可能重新读取和校验整个对象，本轮没有跨请求明文缓存。

## PC预览与关闭

`/api/lifecycle/bootstrap`增`media_employee_read_enabled:boolean`。开启时Web媒体条目可增`thumbnail:{status,mime_type,byte_size}`，READY仅JPEG且不超过160KiB；PENDING/UNAVAILABLE不携带MIME/大小。成员V1/V2 DTO不新增该字段。

图片与视频小图由既有Worker生成，最长边960px，视频定位`min(1秒,实际时长/2)`；同一对象先小图再播放副本，失败保留原件、记录安全错误，不无限重试。旧附件列表开启时仅核登记及来源元数据，available不再保证文件已预先解密。

PC最多同时取两个Web小图，点击操作优先于未开始预览；旧登记图片沿单读取。小图缺失不自动下载完整Web原件；音视频点击后原生同源加载、`preload=none`及Range。切事项、离开或退出释放请求与元素资源。

关闭开关恢复旧端点和前端加载方式，停止新增视频封面。070迁移及派生文件保留，继续原到期清理。执行前向迁移使用既有编译维护入口的`--target=previews --check|--apply`，要求目标数据库身份明确；本地实现不授予现场执行许可。结果见[交付清单](../../../plans/pc-admin-electron/media-employee-read-2026-10-28.md)。
