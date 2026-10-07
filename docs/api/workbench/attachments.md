# 已保存报修附件的受控读取（WBINT-T16 / #71）

W 的现有认证宿主；`workbenchAttachmentsEnabled=false` 为默认值，`attachmentStore=null` 为默认装配。不新增上传、注册 HTTP、SDK 下载、模型或 OCR。现有 normalized `wmr_` 只是媒体定位引用；只有受信服务器登记且已私有保存的资产才具备读取前置。

## HTTP 合同

- `GET /api/workbench/items/{kind}/{id}/attachments`：`kind=ticket|review|intake`，UUID `id`，无 Query；当前活动内部 Principal 和事项范围每次在真实数据库重新核验。返回 `AttachmentPage`：`available:boolean`、`reason:null|稳定原因`、`items:AttachmentMetadata[]`、`truncated:boolean`。最多 20 项；达到上限明确显示截断，不返回隐藏对象总数。
- `GET /api/attachments/{attachmentRef}?kind={kind}&id={id}`：不透明 UUID ref；仅这两个必填 Query，不能重复。ref 本身不授予访问权；每次核对当前事项及该资产的服务端来源关联。GET 只下载，不提供 HEAD、Range、永久 URL 或 inline 预览；带 Range 明确拒绝。
- 元信息只含 `ref`、服务器生成的 `display_name`、`mime_type`、`byte_size`、`available` 与 `reason`；不含原文件名、路径、object key、原始身份、来源 URL、AES/key 或明文内容。PNG 名称固定为“报修附件.png”，JPEG 为“报修附件.jpg”。读取前置不足的项明确不可用。
- 200 内容为已认证 PNG/JPEG bytes，`Content-Disposition: attachment; filename="report-attachment.png|jpg"`，准确 Content-Length、`no-store`、`nosniff`、`Referrer-Policy:no-referrer`、CSP `sandbox; default-src 'none'`。错误始终安全 JSON；已经发出头部后的错误销毁流，不拼接 HTML。
- 未登录/已过期会话为现有 401；当前事项失权沿现有 403/404；ref、不存在的关联、错误事项、仅 quote 的引用为 `ATTACHMENT_NOT_FOUND` 404。获权但存储未装配为 `STORAGE_UNAVAILABLE`；过期为 `ATTACHMENT_EXPIRED` 410；缺失文件 `ATTACHMENT_MISSING` 404；超限、格式、不可信/扫描未通过和完整性分别为 `ATTACHMENT_OVERSIZED|UNSUPPORTED|UNTRUSTED|INTEGRITY_FAILED` 422；单读取繁忙为 `ATTACHMENT_BUSY` 429；deadline 为 `ATTACHMENT_TIMEOUT` 504。关闭或配置错误保留不可用，不能现取 Provider。

## 来源、权限与留存

复用唯一 Ticket/Intake/Channel Message。资产必须匹配真实 `service_intake_message` 的 PRIMARY/SUPPLEMENT/CLARIFICATION 关联，并匹配 Inbox **正文** `content[].media.download_ref`，quote 不据此获取原始引用的权限。来源 Intake 为事项本身，或 Ticket 明确关联 Contact Journey 下的来源 Intake；仅同群、参与者或共享 Journey 不能给其他 Ticket 扩权。关联 Journey、来源 Intake、Inbox 和 asset 任一过期即不可用，Ticket 长期存在不复活媒体。

仅对既有 ADMIN/DISPATCHER/HANDLER 范围内，可信 `INTERNAL|SENSITIVE_INTERNAL` 材料开放。登记或 Inbox/Intake 的 PATIENT_SENSITIVE/SECRET/PERSONAL 原始资料保持拒绝，需要另行明确的更窄业务授权。每个 64KiB 输出块前重查 Principal、事项、关联及所有保留截止；失权/过期中止后续输出，已发出的字节不可撤回。

## 私有只读存储合同

无数据库变更；038 未使用，固定历史 migration 清单不变。Storage Port 从显式注入的 private root 和 32 字节 key 读取，不加载 `.env`。服务器受信维护 `manifest.json`（≤256KiB，version=1，≤500 assets）；浏览器没有登记/改写入口。每项字段与严格类型见 `workbench_attachment_contracts.d.ts`，包含 message/intake/media ref、MIME、精确大小、SHA256、物理 epoch 毫秒保留截止、扫描记录与分类；元信息不能虚构现有媒体。

文件为 `{opaque UUID}.asset`，字节序 `12-byte IV || 16-byte GCM tag || ciphertext`，AES-256-GCM；AAD 为该项按 Contract 字段顺序的 UTF-8 JSON，绑定来源、保留、扫描、分类、大小、MIME 和 hash。key 通过显式注入交给受信运行装配；Manifest 与文件路径需仅由受信资产登记者维护，private root 的 ACL/生命周期由运行配置保障，不作为明文存储豁免。现有 G0 捕获不转换为资产。

Lease返回该次认证的不可变描述；HTTP将最初授权、lease描述、头部前和每块的当前登记逐字段序列比较，变更即完整性拒绝，不能把旧文件流与新来源／截止混用。路径检查拒绝静态链接，并以lstat/fstat身份检测打开前替换；打开后只用同一句柄，后续重命名不切换读取对象。Windows/Node没有这里可用的目录句柄相对原子open合同，祖先目录的对抗性瞬时替换仍由受信private root ACL前提控制，不宣称抵御持key且可修改目录的恶意管理员。GCM/AAD/SHA提供另一层内容与登记绑定。

实际文件在同一已校验句柄读取；拒绝 traversal、绝对文件 key、symlink/junction 祖先、链接文件和 inode/dev 替换。读入有硬上限，不信任扩展名或声明大小。完整 GCM 认证和 SHA256/Magic/MIME 后才发送任何明文；单文件 ≤10MiB，仅一资产在内存，ciphertext/plaintext 有界，HTTP 64KiB 分块与背压，不能将 GCM 未认证 plaintext 直接外发。PNG校验签名、尺寸、分块边界与CRC、IDAT/IEND；JPEG校验尺寸、有限marker与SOF/SOS/EOI结构。均限制8192边长、16777216像素，结构检查不等同完整像素／熵解码或恶意内容扫描。PNG/JPEG仅受控下载，不承担任意格式预览；HTML/SVG/其他格式明确不可用。扫描记录必须来自受信登记过程；此只读实现没有内置 scanner，生产登记能力仍需独立提供，合成测试预置 PASSED 不证明生产扫描。

附件扩展同时最多1个未完成的元信息／下载校验操作及1个读取lease；其余请求明确429 BUSY。准入在认证宿主之后、所有来源与文件校验之前占有，并保持到已发出的PG/fs调用settle。取消不会提前释放逻辑准入；close取消操作并等待其完成。Deadline15秒；客户端断开、取消和宿主停止关闭流/句柄并清零plaintext/key的自有副本。复用既有App/Worker/PG/pool，Gateway无新增连接，SSE32和总池预算保留。物理过期删除归受信存储留存维护，读取强制截止；不自动删Ticket/旧事实。

Deadline取消后续分块、HTTP背压等待及lease；本地文件IO按≤64KiB读循环检查取消，已发出的PG查询和内核fs调用需返回后才观察信号。此合同复用既有有限数据库池并要求受信本地私有文件系统正常提供IO，不能强制抢占正在执行的PG/fs调用；不把合成测试的清理结果当作故障存储或数据库的硬实时保证。

## 前端和关闭方式

正式事项详情增加独立“报修附件”区域。元信息由 HTTP 获得；点击才读取 bytes。错误以 React 文本显示，未知响应/HTML 不信任；不 iframe/object、不执行原文件。请求绑定账号+kind+id+ref；切事项/离开/失权取消并释放 Blob URL。401 清会话缓存；403/404 清当前事项和附件并重读授权列表。成功下载仅使用本次通过校验的 Blob；不持续预览/缓存敏感 bytes。

关闭时设置 `workbenchAttachmentsEnabled=false` 并停止宿主/Store；保留 Ticket/Intake 事实和受信私有资产，页面明确显示存储不可用。key/资产源的生产装配、扫描/登记和真实资料演示未在本票授权范围；本票用全新合成隔离资产证明读取。测试、被测制品和清理见 [本票记录](../../../plans/admin-workbench-integration/execution/t16.md)。
