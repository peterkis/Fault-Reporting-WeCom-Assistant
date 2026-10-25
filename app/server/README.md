# 后端应用

业务及平台实现位于 `src/`，启动、迁移、检查及演练脚本位于 `scripts/`。模块名、脚本名、执行模式和授权边界保持原合同。继续使用仓库根的依赖、锁文件、TypeScript 严格配置及统一构建。

在仓库根执行：

```powershell
npm run migration:build
node .build/tools/gate.mjs types
node .build/tools/verify-artifact.mjs
node .build/runtime/app/server/scripts/human-workbench.mjs --check
```

正式 Node 入口位于 `.build/runtime/app/server/src`／`scripts`，根 `shared` 的运行模块位于 `.build/runtime/shared`。PC／H5 资产仍位于运行树的 `web/admin-workbench`／`h5`，从制品读取；缺失时失败关闭。开发前端仍使用各自既定 base 和 API 代理。

公共类型与 Schema 在根 `contracts`，SQL 在根 `database/migrations`，跨应用测试在根 `tests`。三个前后端共用纯模块在根 `shared`；PC 浏览器专属合同及实时客户端在 PC 源码中。旧 `src/...`／`scripts/...` 的逻辑身份与新物理位置由[迁移映射](../../tools/ts-migration/backend-layout.json)对应，固定历史 checkout 继续使用其当时路径。

私有环境文件保持原明确位置，不自动探测、复制或迁入本目录。脚本中真实发送、现场写库、云准备或部署仍需各自原授权；目录迁移不会授权这些操作。三份 PowerShell／Shell 脚本保持源码用途，不自动加入运行资源。

2026-10-24 源码迁移及本地验证执行已收口；全部失败及工具 rename NOT_RUN 保留，不代表无保留验收通过。实际结果见[后端迁移记录](../../plans/app-layout/server-migration-2026-10-23.md)，目录与合同见[应用目录整理记录](../../plans/app-layout/README.md)及 [ADR-0044](../../adr/0044_server_application_layout_and_logical_source_identity.md)。本地结果不替代 GitHub Issue、远端 full／certify 或业务 Gate。
