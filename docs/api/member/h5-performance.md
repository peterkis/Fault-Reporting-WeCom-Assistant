# H5 页面引导与性能读取

本页是[ADR-0036](../../../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)的前向接口合同。宿主为M／F，沿原成员Cookie、企业／应用范围及当前READ授权。`YIXIAOXIU_H5_ENABLED`和新增`YIXIAOXIU_H5_PERFORMANCE_ENABLED`都须显式true；默认false。原[V1自助](self-service.md)和[H5 V2](h5-v2.md)继续兼容。实现与实测状态见[实施记录](../../../plans/yixiaoxiu-h5-performance/README.md)。

所有JSON读请求无正文，拒绝cross-site、错误Host／Origin、重复或未声明query；`no-store`。一次HTTP实际Provider资格核验按请求复用，等待后及返回前仍核当前会话／范围。当前资格拒绝401／403，Provider暂不可用503；他人或过期绑定404。不向浏览器下发目录内部身份、文件路径、token或内部备注。

## 页面引导

`GET /api/yixiaoxiu/h5/entry`

必需唯一`view`：home、report、reports、request、department。

| view | 允许的其他query | data |
| --- | --- | --- |
| home | 无 | recent_reports，本人最新最多3条；department_summary为当前获权科室真实统计或null；无完整分页游标 |
| report | 无 | null；只取bootstrap和能力 |
| reports | source=WEB/BOT、search最多100字符、status=OPEN/ACTIVE/COMPLETED | reports，最多20条及next_cursor |
| request | 必需request_ref，32位不透明引用 | detail及timeline，正文／材料仍限本人 |
| department | search/status，规则同上，无source | department，20条及next_cursor／total／active_count |

成功200为闭合`H5EntryResponse`：schema_version=1、view、bootstrap、membership_revision、data。bootstrap包含原CSRF／recovery_scope与h5能力；membership_revision是当前获权组织关系的不透明修订值，不授予权限。view必须与请求一致。功能未启用时404且code=YXX_H5_ENTRY_DISABLED；前端只对此明确码回退原bootstrap／V1/V2读取，不把对象404解释为入口缺失。

2026-10-21的本地前向修订将`home.data.department_summary`设为必填：`can_view_department=true`时返回`{total,active_count,membership_revision}`，修订值必须与entry相同；无科室READ时返回null。首页本人预览与统计共用一次集合SQL，开始成员投影及返回前的新语句权限/组织终检保留，整页首页业务SELECT上限仍为3。确认成员范围后一次播种两份缓存，冷启动及统一刷新不再另取统计；未知读取错误不能伪装null或0。

request的detail保留原本人安全字段，补充仅最近20条，supplements_cursor用于继续读取。h5.media新增thumbnail对象（非图片null）：status=PENDING/READY/UNAVAILABLE，url／mime_type／byte_size无可用副本时为null。原H5 V2媒体DTO不扩字段。

同日后续性能修订允许Home的科室集合和无筛选Department首屏采用[ADR-0036中的有限封闭在途批次](../../../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)。外部DTO不变；每HTTP独立Provider、初始profile及返回前新语句／外层READ终检，只有SQL内当前精确授权集合与所有读取条件相同才共享来源扫描。派发后不附着、完成后不缓存；本人预览和签名游标仍各自生成。每实例单活动SQL批、每批10人、全生命周期slot合计20、编码输入256KiB／原始结果编码4MiB，独立Provider前开始5秒单调时钟交付截止；超额429、超时503，未知数据库错误不变成空成功。批次物理SELECT与各HTTP参与读取阶段分别记录，Home／Department≤3及原1.5秒HTTP预算不变。

timeline为`{status:"READY",data:{items,next_cursor}}`或`{status:"UNAVAILABLE",code:"YXX_UNAVAILABLE"}`。首批最多20条，沿原签名游标。仅明确250ms SQL超时可在保存点恢复后降级；授权、留存或未知错误不会降级为空数据。

当前成员核验的性能入口仅由Native在上述合法entry校验后选择；原BASE／写／发送／Gateway不选该入口。同一APP最多2实际Provider操作、32总项，H5_ENTRY可占2、BASE最多1，共享容量而非叠加队列；默认性能未开时仍原1／32。每项5秒含排队，底层未settle继续占槽，每HTTP恰一次实际核验且无跨请求资格缓存；同请求的普通Query授权复用pending后重新检查当前会话，不再发Provider。终检与SQL3／6／3及1.5秒预算不变，详见ADR-0036。

合成请求：`GET /api/yixiaoxiu/h5/entry?view=request&request_ref=HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH`。页面和查询缓存只有在确认当前recovery_scope后填充，组织关系变更清除旧科室数据。

## 科室统计

`GET /api/yixiaoxiu/h5/department-summary`

无query、无正文。200为`{total,active_count,membership_revision}`，都是当前可靠组织关系下的有限统计；无组织权限403。独立刷新和旧路径兼容保留该接口；新的首页首屏直接消费entry内统计，不额外发起本请求。未取得统计不显示虚构零值；不读取完整列表或原报修内容。

## 补充历史

`GET /api/yixiaoxiu/requests/{requestRef}/supplements`

可选cursor及limit（默认20、1–50），200为`H5SupplementPage`的items／next_cursor，item仅input_revision／text。游标签名绑定原成员／企业／应用／request与快照边界，最近批次优先，继续向更早历史读取。原同路径POST与旧详情的supplements保持原合同。

## 私有媒体与渐进播放

现有`GET /api/yixiaoxiu/requests/{requestRef}/media/{mediaRef}`在性能开关显式启用后支持THUMBNAIL及单Range，并新增同路径`HEAD`。默认variant仍PLAYABLE；ORIGINAL继续attachment，其他变体inline，所有表示no-store／nosniff。

HEAD返回获权对象完整MIME／大小及Accept-Ranges=bytes，无正文。GET单区间返回206、精确Content-Length／Content-Range；suffix与open-ended受同一上限。不可满足区间416及`Content-Range: bytes */{size}`，只在当前READ通过后返回。多区间忽略Range返回完整200；不实现multipart，携带If-Range而无支持的验证器时返回200。原无Range读取保持200。

每次范围请求与等待后复核原本人绑定／留存，每64KiB输出块前复核当前READ；GCM标签及完整内容SHA验证成功前不输出明文。THUMBNAIL最长边960px、最多160KiB，与原件一样私有加密及到期清理，失败不删除原件。视频播放副本最长边720px、24fps、最多8MiB，原件大小限制不变。

每个既有App／Worker实例内，磁盘／加解密单并发，HTTP读取租约最多2个，明文与在途输出预留合计最多32MiB，等待合计8项，60秒含排队；超限429。App与Worker不共享跨进程信号量；性能路径Worker预留28MiB，两进程受控媒体缓冲最多合计60MiB，回退路径最多64MiB。RSS与FFmpeg内存另行记录。Worker单线程、25秒转码截止，不新建服务／数据库池。浏览器上传继续串行，播放preload=none，不为等待完整Blob阻塞首帧；失权清理媒体和缓存。写命令与UNKNOWN仍保留原UUID，不自动重试。

## 公开资源与关闭

编译HTML继续no-store；manifest登记且校验通过的内容哈希资源可immutable缓存，gzip／Brotli表示与原件同时登记和校验，正确返回Vary／Content-Encoding。公开Buffer缓存最多4MiB；业务响应、媒体、身份结论不进入此缓存。设计原件、源码、preview、未声明资源、路径越界和符号链接继续拒绝。

可显式配置`YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT`为上一代已验证编译H5目录，只对其登记的旧asset回退，不回退旧HTML或源码；默认未配置。关闭性能读取开关后页面沿明确disabled码回原读取，派生媒体须保留到期清理能力。真实部署、现场写库、发送、Gate和实机验收不因本地性能通过而获准。

类型：[entry DTO](../../../contracts/yxx_h5_entry_contracts.d.ts)、[媒体 DTO](../../../contracts/yxx_h5_media_contracts.d.ts)；实现：[成员HTTP](../../../app/server/src/yxx-self-service-native-http.mts)、[H5 HTTP](../../../app/server/src/yxx-h5-http.mts)、[查询](../../../app/server/src/yxx-self-service-query.mts)、[媒体](../../../app/server/src/yxx-h5-media.mts)、[静态](../../../app/server/src/yxx-h5-static.mts)；验证：[HTTP测试](../../../tests/yxx-h5-http.test.mts)、[查询集成](../../../tests/yxx-h5-entry.integration.test.mts)、[静态边界](../../../tests/yxx-h5-static.test.mts)。
