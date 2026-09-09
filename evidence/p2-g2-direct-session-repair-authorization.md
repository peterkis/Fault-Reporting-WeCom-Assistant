# P2-G2 Direct Session 最小领域修复授权

2026-09-08，负责人明确回复：“授权按该方案修复 Direct Session 续接与新故障分界”。方案为 `p2-g2-direct-session-gap.md`，原始2项数据库RED及正常分界对照保留。

允许在入站持久化既有事务内优先使用同Provider/Bot/Reporter、活动且有效的Direct Session与既有绑定选择原Intake；明确新增故障跳过续接。不得跨身份、猜测多个候选或复活过期/结束会话。复用现有Intake追加、Session边界与Ticket命令，不新增数据库结构或第二事实源。P1独立装配继续使用其90秒碎片窗口；P2通过显式装配参数注入Session选择。

按既有docs33的空闲边界契约，P2装配显式使用正整数空闲上限30分钟；G2配置同步冻结该值，测试可注入较短正整数验证边界。与数据留存期限分别校验，不能延长任何既有留存期限。

继续原P2-G2准备任务，完成必要契约、RED/GREEN、完整矩阵与自动化回归及就绪候选提交，停在READY_FOR_LIVE_E2E。AI关闭，不启动P2-008，不真实发送、不关闭Gate、不push/merge/tag。
