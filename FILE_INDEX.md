# 文件索引

## 权威入口

- `AGENTS.md`：不可违反的开发规则与阶段边界；
- `README.md`：V1.2 架构摘要；
- `docs/architecture_baseline_status.md`：唯一有效架构、废弃架构、当前 Phase 和迁移路径；
- `plans/current_phase.json`：机器可读当前阶段；
- `plans/roadmap.md`：G0/P1/P2/P3 路线图；
- `plans/master_backlog.json`：机器可读任务状态；
- `tasks/master_backlog.json`：精简任务索引。

## 阶段计划

- `plans/phase_0_wecom_poc.md`：Gate 0；
- `plans/phase_1_public_pilot.md`：公网试点与 Pilot Ticket Core；
- `plans/phase_2_ai_enhancement.md`：AI/OCR 异步增强；
- `plans/phase_3_hospital_integration.md`：Ticket Adapter 与 Hospital Tickets 融合。

## 任务明细

- `tasks/ARCH-001_architecture_baseline_cleanup.md`：已完成的架构基线整理验收记录；
- `tickets/G0_gate0_tasks.md`；
- `tickets/P1_pilot_tasks.md`；
- `tickets/P2_ai_enhancement_tasks.md`；
- `tickets/P3_hospital_integration_tasks.md`。

## Gate 0 证据与 PoC

- `scripts/g0-001-test-wss.ps1` 与 `evidence/g0-001-wss-network-report.md`：WSS 网络路径验证；
- `src/g0-002-sdk-lifecycle.mjs`、`tests/g0-002-sdk-lifecycle.test.mjs` 与 `evidence/g0-002-sdk-authentication-report.md`：官方 SDK 认证、心跳、错误凭据与断开验证；
- `src/g0-003-frame-capture.mjs`、`tests/g0-003-frame-capture.test.mjs` 与 `evidence/g0-003-text-capability-matrix.md`：文本 Frame 的脱敏捕获与能力矩阵；
- `src/g0-004-media-capture.mjs`、`tests/g0-004-media-capture.test.mjs` 与 `evidence/g0-004-media-capability-matrix.md`：图片、图文混排与文件的内存下载/AES 解密、脱敏记录及能力矩阵；
- `src/g0-005-active-push.mjs`、`tests/g0-005-active-push.test.mjs` 与 `evidence/g0-005-active-push-matrix.md`：主动 Markdown 推送、回执、客户端提醒及 Markdown 后独立纯文本 @ 序列的脱敏验证；
- `src/g0-006-template-card.mjs`、`src/g0-006-group-reply-mention.mjs`、对应 `tests/g0-006-*.test.mjs`、`evidence/g0-006-template-card-matrix.md` 与 `evidence/g0-006-group-reply-mention-captures.jsonl`：模板卡片、按钮事件、`task_id`、5 秒更新、重复点击、过期行为，以及绑定群回调 `req_id` 的被动回复 @ 脱敏验证；
- `src/g0-007-stability-soak.mjs`、`tests/g0-007-stability-soak.test.mjs` 与 `evidence/g0-007-stability-report.md`：本机 Windows 连接稳定性、重连、资源采样和消息重放观察；真实浸泡正在执行。
- G0-001 至 G0-006 已完成；G0-007 正在执行。

## 其他规格

- `docs/`：PRD、架构、领域、识别、状态、API、数据、安全、测试与运维；
- `docs/18_wecom_temporary_media_constraints.md`：企业微信临时素材三步上传、短期媒体租约、回复/主动投递、时效、限流、隐私和验收约束；
- `adr/`：架构决策及其取代关系；
- `architecture/`：Mermaid 架构图；
- `contracts/`：机器可读接口和事件契约；
- `config_examples/`：示例配置；
- `examples/`：验收和消息转换样例；
- `source/`：历史来源资料，不是当前执行基线。
