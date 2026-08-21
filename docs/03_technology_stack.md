# 03. 技术栈与版本策略

## 1. 选型原则

1. 复用医院现有技术体系；
2. 关键链路减少技术种类；
3. AI 服务与业务服务解耦；
4. 版本必须锁定；
5. 任何升级先在 Gate/测试环境验证；
6. 不因追求“先进”引入难以维护的基础设施。

## 2. 推荐技术栈

| 层级 | 推荐技术 | 用途 |
|---|---|---|
| 企业微信接入 | Node.js 24 + TypeScript | WebSocket Gateway |
| 官方 SDK | `@wecom/aibot-node-sdk` | 长连接、消息、卡片、媒体 |
| Web 框架 | Express 或现有 Node 服务框架 | 健康检查、内部 API |
| 前端 | Next.js 16 + React | 医生/工程师响应式 H5 |
| 工单核心 | 现有 Tickets | 唯一工单事实源 |
| 数据库 | PostgreSQL 18 | 消息、Intake、事件、Outbox、审计 |
| 缓存 | Redis 7.2 | 短期聚合、限流、缓存、单活租约 |
| 对象存储 | MinIO | 私有截图和处理附件 |
| AI 服务 | Python 3.12 + FastAPI + Pydantic | OCR、分类、结构化输出 |
| OCR | PaddleOCR 候选 | 截图文字和错误代码 |
| 本地模型 | 2B—4B 级量化模型候选 | 模糊文本结构化抽取 |
| 推理适配 | 内部 Provider Adapter | Ollama/llama.cpp/vLLM 可替换 |
| 可观测性 | OpenTelemetry + Prometheus/Grafana 或院内现有平台 | 指标、链路、告警 |
| 部署 | Docker Compose、systemd 或 PM2 fork | 轻量部署 |

## 3. 官方 SDK 基线

规格包生成时参考官方仓库：

```text
https://github.com/WecomTeam/aibot-node-sdk
```

官方 README 描述的能力包括：

- WebSocket 长连接；
- 自动认证；
- 心跳和指数退避重连；
- text/image/mixed/voice/file；
- 模板卡片和事件；
- 主动推送；
- 文件下载和 AES 解密。

仓库 `package.json` 在本次读取时标识版本为 `1.0.6`。生产实现不应盲目使用 `latest`，应在 Gate 0 验证后锁定具体版本和包完整性。

## 4. SDK 隔离策略

目录建议：

```text
packages/wecom-adapter/
├── src/client.ts
├── src/events.ts
├── src/message-normalizer.ts
├── src/media-downloader.ts
├── src/card-builder.ts
├── src/error-mapper.ts
└── src/types.ts
```

业务代码只依赖内部接口：

```ts
interface WeComChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  send(target: WeComTarget, message: OutboundMessage): Promise<SendResult>;
  downloadMedia(input: EncryptedMediaRef): Promise<DownloadedMedia>;
}
```

## 5. Node.js 规范

- TypeScript `strict: true`；
- 使用 ESM 或项目现有模块规范，不能混乱；
- 统一配置解析和启动时校验；
- 异步处理必须捕获异常；
- 使用 `AbortSignal` 控制超时；
- 不在消息回调中执行长时间 OCR/LLM；
- 结构化日志；
- 健康检查区分 live/ready；
- 优雅退出，停止接收、等待事务完成、断开 WebSocket。

## 6. Python AI 服务规范

- Python 3.12；
- FastAPI；
- Pydantic 强 Schema；
- 推理和 OCR 使用独立 Worker 池；
- 限制请求大小和并发；
- 不接受任意文件路径；
- 不执行工具调用；
- 不直接访问 Tickets 数据库；
- 只返回建议；
- 模型和 Prompt 版本必须进入响应和审计。

## 7. 数据库规范

- 所有外部消息 ID 建唯一索引；
- 状态变更使用事务；
- Outbox 与业务事件同事务；
- 时间统一 `timestamptz`；
- JSONB 仅存非核心扩展字段；
- 关键查询字段必须结构化；
- 原始消息可加密或隔离存储；
- 大文件不进数据库；
- 使用显式外键或可审计的逻辑引用；
- 生产迁移必须可回滚或具备前滚修复方案。

## 8. Redis 使用边界

允许：

- 90 秒上下文聚合；
- 发送限流；
- 单活租约；
- 非关键缓存；
- 短期去抖。

不允许：

- 作为唯一消息队列和事实源；
- 仅在 Redis 中保存尚未落库的报修；
- 用 Redis 状态替代 Ticket 状态；
- 因 Redis 丢数据造成漏单。

## 9. 不推荐的技术

第一阶段不引入：

- Kafka；
- RabbitMQ；
- Celery；
- Kubernetes；
- 独立 BPM 平台；
- 多 Agent 编排；
- 图数据库；
- 全量向量数据库。

达到明确业务规模和运维能力后再评估。

## 10. 版本与供应链策略

- 所有依赖使用 lockfile；
- 生产构建生成 SBOM；
- 镜像固定 digest；
- SDK 升级先通过 Gate 0 回归矩阵；
- OCR/模型升级必须在固定评估集上比较；
- 依赖漏洞分级处理；
- 不允许自动升级生产核心依赖；
- 所有模型文件记录来源、哈希、许可和版本。
