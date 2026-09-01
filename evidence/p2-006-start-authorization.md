# P2-006 Start Authorization Evidence

- 授权日期：2026-09-01
- 授权角色：项目负责人
- 唯一授权任务：P2-006
- 基线提交：`6afe8157bfcae49d391d0f6e2aa5c60388377ea5`
- 当前分支：`phase2/realtime-workbench`
- 当前 Lane：`P2-B`
- 数据库边界：无数据库结构变更；不创建 migration 022，不修改既有迁移

## 授权范围

本次只授权 Human-only Workbench Internal Alpha / Reference Client、Node 原生 REST、注入式认证、Pilot Principal/Role/Team 授权适配、现有 Timeline/Communication/Control Port 的 HTTP Adapter、P2-003 SSE Route、Polling fallback，以及隔离 PostgreSQL、合成 Principal、Mock Sender 和系统 Edge/Chrome 下的测试。

当前 Native HTML/CSS/ES Module 仅作为可替换表现层，不冻结最终生产前端技术栈、组件库、Design Token、品牌视觉或发布体系。

## 保持关闭与未装配边界

- P2-G1 仍为 `NOT_STARTED / REQUIRES_SEPARATE_AUTHORIZATION`；
- P2-007 及以后仍为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`；
- 所有 P2/P3 Feature Flag 保持 `false`；
- 不连接真实企业微信 Sender；
- 不把 P1 企业微信入站正式装配到 Conversation Projector；
- 不连接真实医院身份、组织或医院内网；
- 不调用模型，不实现 AI、Media/OCR 或 Incident；
- 本授权不等同于生产、临床、公网或 SSE 生产启用。

## 明确停止线

项目负责人正式、独立授权启动 P2-006。
完成 P2-006 后必须停止。
P2-G1 组装、P2-007 及以后任务和所有生产功能仍须另行授权。
