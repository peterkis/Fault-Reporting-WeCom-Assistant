# P2-G2 多Reporter候选聚合缺口

2026-09-08。`BLOCKED_BY_DOMAIN_GAP`；尚未READY。以下是独立Reviewer在真实隔离PostgreSQL、正常原文Frame与既有Worker上的复现，不是用构造的Rule输出代替识别。

## 实际反例

| 冻结Source | 实际结果 | 缺口 |
|---|---|---|
| P2-007-X031 | 三位Reporter各形成一个Ticket；Candidate Decision总数0 | 三条明确断网均已受理，但没有跨Intake候选聚合入口 |
| P2-007-X029 | 前两位各Ticket1；第三句“工作台全空白。”为NEEDS_DESCRIPTION/Ticket0；Candidate总数0 | 单句识别缺口与多Reporter聚合缺口并存，不能用同一个计数掩盖 |
| P2-007-X035 | Inbox/Intake各1，Worker抛P2_015_ACTION_FAILED；Decision/Ticket/Review均0 | critical明确故障的推荐布尔值与既有建单Action不一致；属于既有识别/安全路由的最小对齐，单独修复记录，不通过新建候选绕过 |

独立证据：`tmp/p2-g2-review-correlation-20260908/reproduce.mjs`、`result.jsonl`、`review.md`、`exit-code.txt`。日志SHA-256：`942631009a9849a351823f063b0e0e65ac44b04863f61919b0794eea917883ef`；脚本SHA-256：`0b361254b2df53230d0df73efe45e9fff3388d5077f303df45e09a7456b4cc5c`。实际退出0表示反例采集完成，不表示Gate通过。三例分别使用隔离库，资源清理完成，Provider调用0；X035使用现有批准合成身份重跑仍失败。

## 不是遗漏一个参数

`generateIncidentCandidate`是既有纯函数，但全src没有生产调用。P2-015正常Worker只读取当前Intake文本；P2-012来源适配器只导入已经存在的Candidate Decision。纯函数不能自行读取其他Intake、核对服务/症状兼容性、过滤真实时间窗口或提供身份/地点权威。把3/5/8人数或monitoring布尔值作为预期直接填入函数，不能证明真实聚合。

D12中的300秒、CROSS_DEPARTMENT/FLOOR等设计描述与当前冻结函数的窗口/枚举存在差异。权威监控、医院身份、活动Incident匹配也不能从普通文字自述推导。须保持原源与差异记录，不能为了通过202条而改阈值、编造地点/身份或把所有机制用例丢进Manual Review。

## 最小独立修复建议

1. 在既有P2-015正常Worker路径补充有界跨Intake事实读取，使用当前Bot、保留期内的有效事实、实际接收epoch和冻结窗口；按已有可信Reporter绑定排重。
2. 仅在Canonical服务/症状相容且Provenance完整时复用现有候选纯函数。缺少身份、地点、监控或活动Incident权威时保留未知或走现有人工审核；不引入医院目录、监控Connector或新的身份/地点权威。
3. 使用既有Decision/Action/ManualReview及P2-012 Candidate导入能力记录幂等来源；不新增迁移、表、Sender、Ticket/Incident状态机，不自动confirm/link，不跨人合并Journey。
4. 先补原始多Reporter正常Frame RED、跨Bot/服务/症状/留存/窗口/重复/重启反例，明确旧设计字段与当前Accepted基线的裁决，再做最小实现与独立复核。原始202条不改，安全指标不降。

原执行提示§5.2要求：“确需改变领域规则、数据库结构或新增能力才能闭环时：保留已完成工作，记 `BLOCKED_BY_DOMAIN_GAP`，返回复现、影响、最小独立修复建议。”此前gold例外仅授权最小确定性识别修复，不涵盖这项跨Intake聚合能力。因此在取得独立授权前，不能实现该聚合器或声称202条/当前Gate已完整通过。
