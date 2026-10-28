# ADR-0050：PC 员工媒体读取与服务端预览

状态：Accepted for local implementation。依据用户于 2026-10-28 确认的方案与本次 PLEASE IMPLEMENT 授权；不是云端部署、现场迁移或 Gate 批准。

## 决策

新增默认关闭的 `workbenchMediaEmployeeReadEnabled`。PC 专用媒体入口复用本次 HTTP 的有效员工会话、活动账户及 ADMIN/DISPATCHER/HANDLER 角色核验；任何此类员工持有已保存媒体 UUID 均可读取，不再按 Ticket、团队、Intake/Journey 关系授权。事项详情与附件发现列表继续原业务权限，不新增媒体目录或全院检索。

Web 对象仅允许 BOUND、未清理且媒体自身到期时间有效的对象；旧登记附件保留登记分类、扫描状态及自身期限。期限在请求开始时判断一次。本次传输不因途中撤权、到期或关联变化中断；下一 HTTP（包括 Range）重新判断。该窄路径前向替代 ADR-0035/0036 及旧附件合同的逐块 READ 与关联终检；H5 报修人及旧 HTTP 入口不采用此规则。

完整 AES-256-GCM/AAD 与 SHA-256 在实际读取时一次验证成功后才输出。既有加密格式、原件、私有根目录保护、背压、取消与 deadline 保持；不增加明文缓存、对象存储、数据库池或常驻服务。Web 复用磁盘单并发、两个读取租约、32MiB 受控明文与8项等待预算。

新入口 `GET /api/workbench/media/{source}/{ref}`，source 为 web 或 attachment。Web 另支持 HEAD、单 Range 和 ORIGINAL/PLAYABLE/THUMBNAIL；attachment 只读原图片。原 HTTP 保留作为关闭后的路径。旧附件列表在优化开启时不再预读和解密文件；available 只表示登记可读，实际缺失或损坏在读取时报告。

Web 图片与视频列表仅取服务端 JPEG 缩略图，最长边960px、最多160KiB。现有单 Worker 优先生成同一媒体的缩略图，再处理播放副本；视频帧取 min(1秒,时长一半)。前向070迁移扩展缩略图约束和索引；历史迁移、原件及播放副本不改写。失败不循环重试、不阻断已成功上传。音视频点击后使用同源地址和原生 Range 播放。

## 配置、验证与回退

单一配置默认 false，同时传给 APP、WORKER 和 PC capability；开启 Web 优化须有066/070及既有转码依赖。关闭恢复原入口、停止新增视频封面，保留派生文件并继续到期清理。

实际编译、合成PG/HTTP/浏览器、2CPU/4GiB比较与失败记录见[交付清单](../plans/pc-admin-electron/media-employee-read-2026-10-28.md)。检验跨团队已知UUID、失效身份、请求级到期、正文零SQL、完整性拒绝、HEAD/Range、缩略图流量、H5原授权、关闭及资源回收。
