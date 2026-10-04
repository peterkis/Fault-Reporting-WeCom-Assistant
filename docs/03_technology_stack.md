# 03. 技术栈与版本策略 V1.4

## 1. 选型原则

1. 保护现有 G0/P1 代码和已验证契约；
2. Unified Ticket Core 只保留一个物理事实源；
3. P2/P3 以模块化单体和 Port/Adapter 增量建设；
4. AI、OCR、SSE 和 Connector 都可关闭；
5. 2 核 4GB 下优先保证入站持久化、人工回复和可靠通知；
6. 不为不存在的历史数据引入迁移平台。

## 2. 推荐技术栈

| 层级 | 技术 | 用途 |
|---|---|---|
| 企业微信 | Node.js 24 + `@wecom/aibot-node-sdk@1.0.6` | 单活 WSS Gateway |
| 应用/API | Node.js 24 + TypeScript strict + ESM（ADR-0026），按 scope 渐进迁移 | REST、SSE、Command、Projection |
| 数据库 | PostgreSQL | 消息、会话、Ticket、事件、Outbox、AI、Integration |
| 前端 | 轻量 React/Next.js 或现有静态工作台渐进升级 | 人工处理界面 |
| 模型 | DeepSeek Provider Adapter | 多轮建议与草稿 |
| 对象存储 | StoragePort | 私有媒体；可用加密本地盘或外部 S3 |
| 内网连接 | 独立轻量 Connector Agent | 主动出站 mTLS HTTPS/WSS |
| 部署 | PM2/systemd/Docker Compose 轻量组合 | 单机运行 |

## 3. 依赖基线

- Node.js：`>=24 <25`；
- `@wecom/aibot-node-sdk`：`1.0.6`；
- `pg`：`8.23.0`；
- 使用 lockfile；
- SDK 升级必须回归 Gate 0 能力矩阵。

## 4. PostgreSQL durable queue

当前规模优先复用 PostgreSQL：

- `FOR UPDATE SKIP LOCKED`；
- Lease；
- 重试和 Dead Letter；
- Inbox/Outbox 与业务事务一致；
- Redis 不作为唯一队列或事实源。

## 5. DeepSeek 边界

- 只接受脱敏文本；
- 默认 `thinking=disabled`；
- 默认并发 1；
- 严格 JSON Schema；
- 记录 Provider、Model、Prompt、Token、Latency；
- 不直接访问 Ticket 数据库；
- 不执行任意工具；
- 自动回复只允许白名单低风险场景。

## 6. 内网 Connector 边界

- 内网主动出站；
- mTLS + 请求签名；
- Source-scoped 凭据；
- 本地 Cursor/Spool；
- 不开放任意 SQL/Shell；
- 不共享数据库；
- 新来源按 Contract 接入；
- 不包含历史 Ticket 导入能力。

## 7. 数据库规范

- 所有外部 ID 有唯一约束；
- Ticket 状态变化使用事务；
- Outbox 与领域事件同事务；
- 时间遵守 [ARCH-005](48_arch_005_asia_shanghai_time_contract.md)：业务 LocalDateTime 为 Asia/Shanghai 的 `YYYY-MM-DD HH:mm:ss`，使用 PostgreSQL `timestamp without time zone`；物理时间、期限与保留期使用十进制字符串及 BIGINT epoch；
- 系统 Schema、第三方内部时间、冻结历史与 Adapter 转换前的外部原始时间沿用 ARCH-005 排除规则；
- JSONB 仅用于扩展字段；
- 大文件不进数据库；
- 概念 Schema 不能直接执行；
- 实现任务获批后再创建编号迁移；
- 禁止复制第二套 Ticket 表。

## 8. 2C4G 不推荐同机组件

- Chatwoot；
- Dify；
- LangBot；
- Kafka/RabbitMQ；
- Elasticsearch；
- Kubernetes；
- 本地 LLM；
- 常驻重型 OCR；
- 完整 Prometheus/Grafana。

## 9. 供应链

- 依赖锁版本；
- 生产构建生成 SBOM；
- 镜像固定 digest；
- 模型和 Prompt 版本化；
- Connector 包签名；
- Secret 不进入仓库、日志或 Evidence。


## 10. TypeScript 增量迁移

见 [ADR-0026](../adr/0026_typescript_strict_incremental_migration.md) 与 [执行入口](../plans/typescript-migration/README.md)。根 strict 类型检查、MTS→MJS 构建及源码/运行/固定历史宿主已经建立；实际迁移范围以 `plans/typescript-migration/scope.json` 的 current_module_map 为准。

- 生产 `.mts` 经 NodeNext 编译为 `.mjs`；相对运行时 import 保留 `.mjs`，前端原型保留独立 Bundler/JSX 配置。
- Node、SDK、pg、TypeScript 与类型包版本以 `package.json` / `package-lock.json` 的实际锁定记录为准；本轮不升级依赖。
- 原 181 项 scope 与 legacy 清单保留，按活动 selection 验证，不追求全仓 JS 清零。
- 新生产 JS 禁止；allowJs 和手写声明不表示未迁移 JS 实现已经严格检查完成。
- 生产只运行编译产物，2C4G 上不增加常驻编译器；开发检查不表示发布认证或生产激活。

本轮只纠正文档时效与 ARCH-005 描述，不改变 SQL、序列化、精度、排序、保留期限或冻结历史。
