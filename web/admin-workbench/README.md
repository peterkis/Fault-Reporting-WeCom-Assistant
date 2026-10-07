# WEB01 正式管理端

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

## 开发与关闭

`npm --prefix web/admin-workbench run dev` 仅绑定 loopback 5194，代理 `/api` 至 loopback 5195；开发者须单独启动已有、获授权的开发 HTTP 服务。生产截图和接入验证不使用 Vite dev/preview。

正式入口沿现有 Workbench 功能开关与认证链启用；默认开关保持关闭。撤销会话/停用内部 principal 后页面和 API 均拒绝读取。回滚以独立 revert/后继 PR 撤销 WEB01 接入；本轮没有数据库迁移或待回滚的新事实表。不得恢复现场档案作为演示数据。
