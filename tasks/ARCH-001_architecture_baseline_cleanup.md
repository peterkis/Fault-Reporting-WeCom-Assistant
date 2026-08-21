# ARCH-001：Architecture Baseline Cleanup

- 状态：DONE
- 完成日期：2026-08-21
- 后续首个可执行任务：G0-001

## 输入

- V1.2 `AGENTS.md`；
- `README.md`、`docs/`、`plans/`、`tasks/`、`tickets/`、`adr/`；
- 架构图、契约说明、环境与配置示例。

## 输出

- 唯一有效的 G0/P1/P2/P3 阶段模型；
- Phase 1 Pilot Ticket Core 架构；
- Phase 3 Ticket Adapter → Hospital Tickets 迁移架构；
- `docs/architecture_baseline_status.md`；
- 重建后的路线图、Backlog 和任务文件；
- 已废弃架构及文件的可追溯记录。

## 验收

- [x] 活跃文档不再要求 Phase 1 直连 Hospital Tickets；
- [x] Phase 1 与 Phase 3 拓扑在权威入口中一致；
- [x] ADR-0002 标记 Superseded，ADR-0007 为 Accepted；
- [x] 当前阶段仍为 G0/READY；
- [x] G0-001 未执行；
- [x] 未修改应用代码。
