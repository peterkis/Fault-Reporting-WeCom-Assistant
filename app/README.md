# 应用目录

本目录按应用边界组织 PC 管理前端、H5 前端和后端服务。先保持根目录统一依赖、锁文件和构建；三个应用的目录边界稳定后，再按维护需要决定是否采用 npm workspaces。

## 整体目标与当前状态

| 目标目录 | 职责 | 当前状态 |
| --- | --- | --- |
| [pc-admin](pc-admin/README.md) | 正式 PC 管理前端 | 第一步迁移；原 `web/admin-workbench` 已移至此处 |
| [h5](h5/README.md) | H5 报修前端及原卡片 Reporter | 第二步迁移和本地验收完成 |
| [server](server/README.md) | 后端业务、API、Worker、Gateway 及专属运行脚本 | 2026-10-24 源码迁移及本地验证执行已收口；保留失败 |

2026-10-24 当前结果：741 个注册入口共 2841 用例，2802 PASS／39 FAIL，29 个失败入口；全部失败及工具 rename NOT_RUN 保留，不代表无保留验收通过。详细边界见[后端迁移记录](../plans/app-layout/server-migration-2026-10-23.md)，本地状态不推进业务 Gate。

2026-10-23 后端源码归入 `server/src`／`server/scripts`，三个前后端共用纯模块归入根 `shared`，PC 专属合同与实时客户端归入 PC。旧根 `src`／`scripts` 的历史身份由受检查映射保留，运行产物使用新物理目录。历史演示原型继续位于 `web/admin-workbench-prototype`，不作为正式前端运行输入。

2026-10-23 第二步将根 H5 的源码、配置、设计基线和用户原型整体移至 `app/h5`，运行制品仍为 `.build/runtime/h5`，页面和资产 base、5196／5197 开发接线保持。以下较早记录中的根 `h5/` 对应当前 `app/h5/`。主工作区原忽略的私有配置不随隔离工程迁移；本轮不启动现场服务或改变持久业务开关；临时合成验收另行记录。

在仓库根执行 `npm --prefix app/h5 run dev` 或 `npm --prefix app/h5 run typecheck`；正式制品继续由 `npm run migration:build` 生成。依赖和锁文件仍在根目录，公共合同不复制到应用内，跨应用加密恢复保留原单一实现。

`contracts/` 继续集中维护公共接口类型和 Schema；`database/` 管理迁移及数据库资源；根 `tests/` 保留跨应用集成、浏览器和系统验收；`tools/` 保留仓库级构建及校验。`docs/`、`adr/`、`plans/`、`evidence/` 仍在根目录维护。

后端继续沿用既有模块化单体及 App/API、Worker、Gateway 角色分工。共享纯函数归属见 [ADR-0044](../adr/0044_server_application_layout_and_logical_source_identity.md)；公共合同不随某个应用搬迁，也不复制业务事实源。

## PC 源码与运行制品

2026-10-22 的第一步仅调整源码位置。统一构建从 `app/pc-admin` 检查、编译并登记来源，继续生成 `.build/runtime/web/admin-workbench`；该路径是运行制品位置，不是另一份源码。既有 `/workbench/app/`、认证授权及功能开关保持原行为，资源缺失不回退源码。2026-10-23 后继范围按 [ADR-0043](../adr/0043_h5_notification_entry_and_legacy_ui_retirement.md)把原 Bot 专用反馈入口并入根 `h5/src/reporter`，不再由 PC 工程单独构建；共享加密草稿模块和反馈恢复入口继续保留。

在仓库根目录执行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm --prefix app/pc-admin run dev
npm --prefix app/pc-admin run typecheck
npm run migration:build
node .build/tools/gate.mjs types
node .build/tools/verify-artifact.mjs
```

开发服务绑定 `127.0.0.1:5194`，`/api` 代理沿用 `127.0.0.1:5195`；开发 HTTP 服务须独立准备。正式验收使用统一构建的 bundle 和现有宿主，不用 Vite dev/preview 代替。

本轮范围、验证和后续工作见[应用目录整理记录](../plans/app-layout/README.md)。历史验收中的旧源码路径仍对应当时被测对象，不回写原 Evidence 或 tested_head。
