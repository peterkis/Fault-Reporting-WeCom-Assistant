# V1.4 架构增量交付报告

- 日期：2026-08-30
- 来源仓库：`peterkis/Fault-Reporting-WeCom-Assistant`
- 基线提交：`8fcb6c1b6d7552d62ac859760c81ca4fba357626`
- 当前阶段：P1 / P1-012
- 类型：累计架构、计划、契约、概念 Schema 和校验增量
- 生产数据库变更：未执行
- 真实 DeepSeek、医院身份和内网 Connector：未连接

## 1. 调整结论

V1.4 保留 V1.3 的 Unified Ticket Core、Conversation Center、并行 Lane、Assembly Gate 和 2C4G 架构，删除 P3 的历史 Ticket 兼容主线。

P3 当前固定为：

```text
New Intranet Source
→ Connector
→ Integration Inbox
→ Service Intake / Ticket Action
→ Unified Ticket Core
→ Projection / Acknowledgement
```

## 2. 删除范围

- 历史 Ticket 导入；
- 未完结 Ticket 切换；
- 旧编号、状态、事件和附件兼容；
- 双系统并行；
- 最终增量；
- 旧系统冻结、归档和退役。

## 3. P3 新退出目标

- 第一条新内网来源完成 E2E；
- 第一条生产内网来源完成受控接入；
- Unified Ticket Core 仍是唯一事实源；
- 重复事件不重复建单；
- Connector 可续传和重放；
- 外部投影不覆盖本地状态；
- 2C4G 无 OOM；
- 关闭 Source 即可回退。

## 4. 自动校验

```text
npm run validate:architecture:v1.4
npm run test:architecture:v1.4
```

校验包含：当前 P1 状态、P2/P3 TODO、P3 绿地模式、无历史兼容 Flag、无迁移批次/最终切换 Schema、P3 Lane/Gate、新来源示例、2C4G 和依赖版本锁定。
