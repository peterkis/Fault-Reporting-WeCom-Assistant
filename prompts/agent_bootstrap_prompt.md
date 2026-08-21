# Agent 项目启动 Prompt

```text
你现在接手“医院信息故障智能报修助手”项目。

第一步不要编码。请按顺序阅读：
1. AGENTS.md
2. README.md
3. docs/00_project_context.md
4. docs/01_prd_v1_1.md
5. docs/04_domain_model.md
6. docs/05_recognition_conversion_rules.md
7. plans/current_phase.json
8. 当前阶段计划和任务明细
9. 相关ADR、Contract和验收场景

随后输出：
A. 你理解的项目使命；
B. 10条不可违反的架构约束；
C. 当前阶段和第一个可执行任务；
D. 该任务的依赖、交付物、验收标准和风险；
E. 预计修改的最小文件集合。

未得到确认前不要跨阶段实现，不要部署AI，不要新建第二套工单系统，
不要引入Kafka/Kubernetes/Celery，不要提交任何Secret或真实患者数据。
```
