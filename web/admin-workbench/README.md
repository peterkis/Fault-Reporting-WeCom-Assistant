# WEB01 正式管理端

2026-10-07后继增量：管理员可在群来源事项详情登记或修改群名称，统一更新卡片、列表和详情。Ticket业务仍只读；名称资料与原始来源分离。新宿主选项sourceGroupDirectoryEnabled默认false，须独立037迁移与显式装配后才开放，详见[接口合同](../../docs/api/workbench/source-groups-design.md)和[ADR-0030](../../adr/0030_admin_confirmed_source_group_names.md)。下文WEB01无迁移/无写入描述是首版交付范围。

生产入口为同源 `/workbench/app/`；保留 `/workbench`、`/workbench/lifecycle` 与成员端。复用原型视觉及 React/Vite/HeroUI/Tailwind，新增 Router 7、Query 5、Zustand、Table 和 Morphicons。精确版本、后续切片适配位置与授权边界见[技术方案](../../docs/ui/admin-workbench-architecture.md)和 [ADR-0029](../../adr/0029_admin_workbench_frontend_boundaries.md)。

## 构建与检查

在仓库根目录、Node.js 24 下执行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run migration:build
node .build/tools/gate.mjs types
node .build/tools/verify-artifact.mjs
```

构建会实际检查所有正式 TS/TSX，生成 hash JS/CSS、Vite manifest、资产及依赖清单，并纳入现有 runtime 制品证明。运行服务只读取 `.build/runtime/web/admin-workbench`，资源缺失报错，不回退源码。不要把独立 Vite dist 复制成另一套生产路径。

普通 PR 使用现有 `v3-p09` selection（本轮保留原入口并增补 WEB01 与直接授权回归），不默认运行 full/certify。隔离数据库环境按迁移执行入口配置后，用现有 runner：

```powershell
node .build/tools/run-tests.mjs --selection v3-p09 --report-dir <仓库外的新报告目录>
```

该 CLI 会构建；已经构建的 CI 使用 `runSelection` 复用同一制品。WEB01 HTTP/浏览器测试通过既有 fixture 创建、填充、删除全新合成数据库；浏览器加载正式 bundle 与 loopback HTTP，使用 DB 校验的内部 test-auth。Gateway、发送器和真实 OAuth 不启动。浏览器截图收据沿现有 runner 校验 SHA-256、归档进报告并清理其原临时文件；失败截图保留用于排查。

## 数据与使用

页面先读取真实 `/api/lifecycle/bootstrap`，再读取 `/api/workbench/board` 三列和 `/api/workbench/items/{ticket|review|intake}/{id}`。每次请求解析当前内部身份，先按已有范围过滤，再 keyset 分页。没有 seed、mock 成功回退或前端身份赋权。

看板和列表共用 Query 缓存；URL 保存视图、关闭范围及选中事项，支持返回、刷新和深链接。每列默认 50、最多 100；页面显示已加载数量及下一页。RESOLVED 明示“已解决待确认”，关闭日期来自真实追加事件。普通未建单受理没有优先级事实时返回 null。资料缺失显示未提供。

全部业务内容只读：无接管、关闭、重开、发送、拖动写状态。Zustand 仅保存侧栏及真实 401/403 触发的界面授权错误标记；身份、凭据和业务事实不持久化。会话失效取消请求并清空缓存；离线、拒绝和错误按真实结果呈现。微动效尊重系统减少动态效果偏好。

## 当前浏览器草稿恢复（WBINT-T03）

后继本地实现通过宿主 `workbenchDraftRecoveryEnabled:boolean=false` 默认关闭；需同时启用内部备注，bootstrap 才返回 `draft_recovery_enabled:true`。当前只接入 TicketNotes；通用存储可复用，后续消费者必须单独定义载荷、当前权限与用途。无服务器草稿服务、跨设备恢复、数据库迁移或新依赖。[接口与只读核对](../../docs/api/workbench/tickets.md#当前浏览器草稿与只读核对wbint-t03)／[实际验证](../../plans/admin-workbench-integration/execution/t03.md)。

仅当前origin／browser profile的原生 IndexedDB `wecom-workbench-drafts-v1`（DB version2，envelope schema1）。范围为内部 `[principal_id,kind,id,purpose]`，当前 `kind=ticket,purpose=internal-note`。公开元数据为该范围、首存／到期epoch、随机revision、IV；敏感 `{schema:1,note,pending}` JSON只存 AES-GCM-256 密文，pending为原T02闭合五字段命令或null。每记录非导出 encrypt/decrypt CryptoKey，96bit新随机IV／128bit tag，AAD绑定schema／scope／首存／到期／revision；不存Cookie、CSRF、OAuth、姓名、原始外部ID、角色或标题。不声称抵御同源XSS／profile访问、磁盘加密／硬件隔离或删除后零化。

| 边界 | 合同与失败行为 |
| --- | --- |
| 固定期限 | 首次成功保存起86400000ms，不续期；活动页和初始化／读写清过期密文与key。浏览器关闭期间无法主动删除，但重新进入不恢复过期内容 |
| 数量／大小 | 每origin最多20份敏感草稿、每份UTF-8载荷JSON最多16384bytes；备注仍最多2000 UTF-16字符。独立opaque未核对操作最多20个、每条最多512bytes；不静默淘汰或遗忘UNKNOWN |
| 频率／交易 | 常规输入最多500ms开始一次保存，POST前强制原快照。原生crypto在短交易外，落盘再核对失效epoch和原revision；保存成功前继续导航／beforeunload保护 |
| 重新验权 | 新bootstrap当前principal与真实GET Ticket读权／add-note后恢复；丢写权但可读仅保留原操作只读核对。网络／503不作为失权 |
| 成功／清理 | 仅匹配原UUID和持久revision删除；较新副本不被旧成功删除。主动丢弃／24h只清敏感副本；退出／可信失权按主体或目标清理，跨标签无正文／凭据信号，迟到写入不得复活 |
| 不可用／损坏 | IDB、WebCrypto、BroadcastChannel缺失，超限或损坏记录：保留当前输入、明确副本未保存，POST前失败阻止发送，无明文降级。坏UNKNOWN标识保留并失败关闭，不转成可提交新UUID |

UNKNOWN持久化不可变原UUID／版本／正文后，刷新／误关可恢复；不自动发送。正文未过期时显式重放原POST；正文已清理时按原opaque UUID只读核对既有receipt。UNKNOWN或无终态不代表原操作失败，不能换UUID绕过；终态COMMITTED／FAILED才收口。核对旧操作保留后来输入，下一次用户明确提交使用新读取版本。已知HTTP成功但本地清理失败保持真实成功，禁止新提交，允许只读核对同UUID并重试清理。

真实退出仅在 `logout_enabled=true` 时可用，沿既有同源／当前CSRF的 `POST /workbench/logout`；可信成功与结果未知分别呈现，两者都停止展示并尝试清本应用主体副本。只清前端缓存不能称为服务器已退出；合成实际员工session／TLS验证见执行记录。关闭 recovery 只停止恢复入口／新增receipt访问，不删已提交Ticket／事件／receipt；遗留密文按固定到期清理，显式退出仍清已知主体副本。源码回退使用独立forward／revert。

## 开发与关闭

WBINT-T38通过 `workbenchRealtimeEnabled=false` 默认关闭的单适配器消费真实授权SSE提示，只使当前主体已挂载活动Query重读。原生Last-Event-ID、gap/容量回退和5秒非重叠周期沿 [实时合同](../../docs/api/platform/realtime.md#正式管理端接入wbint-t38)。输入、焦点、滚动与当前操作对象保持，可信失权优先清除显示与本地scope；暂时REST错误保留最后确认数据并阻止新prepare，原UNKNOWN只由用户核对。SSE单独失败且REST健康仍允许人工写，事件不自动POST或覆盖状态。关闭不创建新的流/轮询；无数据库迁移、新进程/池、presence或音效。实际源/制品、真实流与清理结果见 [本票执行](../../plans/admin-workbench-integration/execution/t38.md)。

`npm --prefix web/admin-workbench run dev` 仅绑定 loopback 5194，代理 `/api` 至 loopback 5195；开发者须单独启动已有、获授权的开发 HTTP 服务。生产截图和接入验证不使用 Vite dev/preview。

正式入口沿现有 Workbench 功能开关与认证链启用；默认开关保持关闭。撤销会话/停用内部 principal 后页面和 API 均拒绝读取。回滚以独立 revert/后继 PR 撤销 WEB01 接入；本轮没有数据库迁移或待回滚的新事实表。不得恢复现场档案作为演示数据。

## 后继工作人员完工（WBINT-T11，默认关闭）

正式600px Ticket详情通过宿主 `ticketStaffCompletionEnabled=false` 装配独立表单；启用须039/040。当前实际处理人填写内部过程和另行确认的安全摘要，编辑摘要重新确认，一条complete POST后GET读取当前版本/状态/轮次。ADMIN/BROAD可见性不能越过当前责任，无Reporter确认、接管、browser命令链或直接发送。

purpose=staff-completion复用T03公共加密store和共享useAuthorizedDraft，独立adapter冻结七字段原命令。bootstrap `staff_completion_draft_recovery_enabled=实际completion能力&&rawRecovery`，Notes限定旧field保持原AND，Notes关闭也可独立恢复本表单；Shell跨tab清理监听任一实际purpose recovery或logout。普通恢复需重新确认摘要；UNKNOWN保持原UUID/body/version/cycle不自动POST；fresh CLOSED无写资格时清敏感内容，保留opaque原标识仅只读receipt。可信失权与晚结果generation fence清缓存/copy，不判旧命令失败。raw recovery关闭无IDB/receipt访问，内存UNKNOWN仍只显式原POST核对。[API/关闭与资源](../../docs/api/workbench/tickets.md#工作人员完工wbint-t11)／[本票实际证据](../../plans/admin-workbench-integration/execution/t11.md)。

## 后继本人跨团队接管（WBINT-T07，默认关闭）

宿主`ticketTakeoverEnabled=false`独立装配600px详情表单。只按当前READ和活动业务权限读取本人真实有效组，多组明确选择；处理人由服务器派生为本人。ADR0031默认同时接管沟通，但不预选Session；独立“本次接管的沟通责任”决定本次POST，原T04/T05恢复控制器保持挂载，无可用新动作且无原intent/result/input或opaque时只隐藏闲置呈现。仅接管保留合法当前状态／原可空轮次，一步开始用单POST与原Core合法原子动作，不在浏览器串联命令。

purpose= ticket-takeover复用T03密文store；原动作、UUID、版本、组与逐Session版本冻结。503隐藏未经核验的恢复选择并保留密文，首次授权临时失败仍可按opaque原UUID显式只读核对；终态按原revision清理，未初始化的表单要求重新读取。raw关闭不创建恢复库，只显式重放内存原POST。丢弃仅清本用途，真实本地会话退出清主体副本，迟到解密／POST／ACK不复活私有视图。[API与关闭方式](../../docs/api/workbench/tickets.md#跨团队本人接管wbint-t07-source)／[本票实际证据](../../plans/admin-workbench-integration/execution/t07.md)。
